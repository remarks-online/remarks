import { randomUUID } from "node:crypto";
import { CreateBucketCommand, S3ServiceException } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  type R2Client,
  createR2Client,
  getObject,
  getPresignedGetUrl,
  getPresignedPutUrl,
  putObject,
} from "./r2.js";

// Requires an S3-compatible endpoint (MinIO locally / CI) — read the env
// directly instead of going through src/env.ts, because the file-level import
// order of integration tests shouldn't force every test to boot the whole app.
function readEnvOrSkip(): {
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_SCREENSHOTS: string;
  R2_S3_ENDPOINT: string;
} {
  const required = [
    "R2_S3_ENDPOINT",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_SCREENSHOTS",
  ] as const;
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    const hint =
      "In CI these are injected by the MinIO service container; locally, run " +
      "`docker run --rm -p 9000:9000 quay.io/minio/minio server /data` and set " +
      "R2_S3_ENDPOINT=http://localhost:9000 R2_ACCESS_KEY_ID=minioadmin " +
      "R2_SECRET_ACCESS_KEY=minioadmin R2_BUCKET_SCREENSHOTS=remarks-screenshots-test.";
    throw new Error(`R2 integration test requires env vars: ${missing.join(", ")}. ${hint}`);
  }
  return {
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID ?? "test",
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID as string,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY as string,
    R2_BUCKET_SCREENSHOTS: process.env.R2_BUCKET_SCREENSHOTS as string,
    R2_S3_ENDPOINT: process.env.R2_S3_ENDPOINT as string,
  };
}

async function ensureBucket(client: R2Client): Promise<void> {
  try {
    await client.s3.send(new CreateBucketCommand({ Bucket: client.bucket }));
  } catch (err) {
    if (err instanceof S3ServiceException) {
      // Both names are emitted by S3-compatible services for "bucket already
      // exists, owned by caller"; treat as success.
      if (err.name === "BucketAlreadyOwnedByYou" || err.name === "BucketAlreadyExists") {
        return;
      }
    }
    throw err;
  }
}

describe("r2 client (integration)", () => {
  let client: R2Client;
  const testRunPrefix = `test/${randomUUID()}`;

  beforeAll(async () => {
    const env = readEnvOrSkip();
    client = createR2Client(env);
    await ensureBucket(client);
  });

  afterAll(async () => {
    client.s3.destroy();
  });

  test("putObject then getObject round-trips the same bytes", async () => {
    const key = `${testRunPrefix}/hello.txt`;
    const payload = "hello r2";

    await putObject(client, {
      key,
      body: Buffer.from(payload, "utf8"),
      contentType: "text/plain",
    });

    const out = await getObject(client, { key });
    expect(Buffer.from(out.body).toString("utf8")).toBe(payload);
    expect(out.contentType).toBe("text/plain");
  });

  test("presigned PUT upload then presigned GET returns the same bytes", async () => {
    const key = `${testRunPrefix}/presigned.bin`;
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const putUrl = await getPresignedPutUrl(client, {
      key,
      contentType: "application/octet-stream",
      ttlSeconds: 60,
    });
    const putRes = await fetch(putUrl, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: payload,
    });
    expect(putRes.ok, `presigned PUT failed: ${putRes.status} ${await putRes.text()}`).toBe(true);

    const getUrl = await getPresignedGetUrl(client, { key, ttlSeconds: 60 });
    const getRes = await fetch(getUrl);
    expect(getRes.ok).toBe(true);
    const got = new Uint8Array(await getRes.arrayBuffer());
    expect(got).toEqual(payload);
  });
});
