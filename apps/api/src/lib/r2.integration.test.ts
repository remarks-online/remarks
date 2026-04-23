import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ensureBucket, readR2EnvOrThrow } from "../../test/integration/r2.js";
import {
  type R2Client,
  createR2Client,
  getObject,
  getPresignedGetUrl,
  getPresignedPutUrl,
  putObject,
} from "./r2.js";

describe("r2 client (integration)", () => {
  let client: R2Client;
  const testRunPrefix = `test/${randomUUID()}`;

  beforeAll(async () => {
    client = createR2Client(readR2EnvOrThrow());
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
