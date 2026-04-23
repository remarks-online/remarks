import { CreateBucketCommand, S3ServiceException } from "@aws-sdk/client-s3";
import type { R2Client } from "../../src/lib/r2.js";

export interface R2TestEnv {
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_SCREENSHOTS: string;
  R2_S3_ENDPOINT: string;
}

// Read R2 env directly (bypassing src/env.ts) — the harness fills in
// placeholder values for tests that don't touch R2, so the presence of an
// R2_S3_ENDPOINT override is what tells us MinIO is actually reachable.
export function readR2EnvOrThrow(): R2TestEnv {
  const endpoint = process.env.R2_S3_ENDPOINT;
  if (!endpoint) {
    throw new Error(
      "R2 integration tests require MinIO. Locally: `pnpm minio:up` (uses " +
        "compose.yml at the repo root), then export R2_S3_ENDPOINT=http://localhost:9000 " +
        "R2_ACCESS_KEY_ID=minioadmin R2_SECRET_ACCESS_KEY=minioadmin " +
        "R2_BUCKET_SCREENSHOTS=remarks-screenshots-test before `pnpm test:integration`. " +
        "In CI these are injected by the workflow."
    );
  }
  return {
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID ?? "test",
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID as string,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY as string,
    R2_BUCKET_SCREENSHOTS: process.env.R2_BUCKET_SCREENSHOTS as string,
    R2_S3_ENDPOINT: endpoint,
  };
}

export async function ensureBucket(client: R2Client): Promise<void> {
  try {
    await client.s3.send(new CreateBucketCommand({ Bucket: client.bucket }));
  } catch (err) {
    if (err instanceof S3ServiceException) {
      if (err.name === "BucketAlreadyOwnedByYou" || err.name === "BucketAlreadyExists") {
        return;
      }
    }
    throw err;
  }
}
