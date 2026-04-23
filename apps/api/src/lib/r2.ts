import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "../env-schema.js";

export interface R2Client {
  s3: S3Client;
  bucket: string;
}

type R2Env = Pick<
  Env,
  | "R2_ACCOUNT_ID"
  | "R2_ACCESS_KEY_ID"
  | "R2_SECRET_ACCESS_KEY"
  | "R2_BUCKET_SCREENSHOTS"
  | "R2_S3_ENDPOINT"
>;

function r2Endpoint(env: R2Env): string {
  return env.R2_S3_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
}

export function createR2Client(env: R2Env): R2Client {
  const config: S3ClientConfig = {
    region: "auto",
    endpoint: r2Endpoint(env),
    // Path-style addressing: required by MinIO (no wildcard DNS for
    // sub-bucket hosts) and accepted by R2. Using virtual-host style would
    // break the test harness.
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  };
  return { s3: new S3Client(config), bucket: env.R2_BUCKET_SCREENSHOTS };
}

export interface PutObjectArgs {
  key: string;
  body: Uint8Array | Buffer | string;
  contentType: string;
}

export async function putObject(client: R2Client, args: PutObjectArgs): Promise<void> {
  await client.s3.send(
    new PutObjectCommand({
      Bucket: client.bucket,
      Key: args.key,
      Body: args.body,
      ContentType: args.contentType,
    })
  );
}

export interface GetObjectResult {
  body: Uint8Array;
  contentType: string | undefined;
}

export async function getObject(client: R2Client, args: { key: string }): Promise<GetObjectResult> {
  const res = await client.s3.send(new GetObjectCommand({ Bucket: client.bucket, Key: args.key }));
  if (!res.Body) {
    throw new Error(`r2: GetObject returned no body for key ${args.key}`);
  }
  const body = await res.Body.transformToByteArray();
  return { body, contentType: res.ContentType };
}

export interface PresignedPutArgs {
  key: string;
  contentType: string;
  ttlSeconds: number;
}

export async function getPresignedPutUrl(
  client: R2Client,
  args: PresignedPutArgs
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: client.bucket,
    Key: args.key,
    ContentType: args.contentType,
  });
  return await getSignedUrl(client.s3, command, { expiresIn: args.ttlSeconds });
}

export interface PresignedGetArgs {
  key: string;
  ttlSeconds: number;
}

export async function getPresignedGetUrl(
  client: R2Client,
  args: PresignedGetArgs
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: client.bucket, Key: args.key });
  return await getSignedUrl(client.s3, command, { expiresIn: args.ttlSeconds });
}

export interface HeadObjectResult {
  contentType: string | undefined;
  contentLength: number;
}

// Returns null when the object does not exist (404/NotFound). Other errors
// propagate — the caller distinguishes a missing upload from infra issues.
export async function headObject(
  client: R2Client,
  args: { key: string }
): Promise<HeadObjectResult | null> {
  try {
    const res = await client.s3.send(
      new HeadObjectCommand({ Bucket: client.bucket, Key: args.key })
    );
    return {
      contentType: res.ContentType,
      contentLength: res.ContentLength ?? 0,
    };
  } catch (err) {
    if (err instanceof S3ServiceException) {
      const status = err.$metadata?.httpStatusCode;
      if (status === 404 || err.name === "NotFound" || err.name === "NoSuchKey") {
        return null;
      }
    }
    throw err;
  }
}
