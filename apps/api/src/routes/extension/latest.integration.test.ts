import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  closeIntegrationDb,
  getIntegrationDb,
  seedUser,
  truncateAll,
} from "../../../test/integration/db.js";
import { ensureBucket, readR2EnvOrThrow } from "../../../test/integration/r2.js";
import {
  type R2Client,
  createR2Client,
  deleteObjects,
  putObject,
  withBucket,
} from "../../lib/r2.js";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  getOrganizationMembershipList: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({
  verifyToken: mocks.verifyToken,
  createClerkClient: () => ({
    users: { getOrganizationMembershipList: mocks.getOrganizationMembershipList },
  }),
}));

const { buildServer } = await import("../../server.js");

const BEARER = "Bearer test.token.value";
const MANIFEST_KEY = "releases/chrome/latest.json";

describe("GET /extension/latest (integration)", () => {
  let server: FastifyInstance;
  let r2Default: R2Client;
  let r2Builds: R2Client;
  const seededKeys: string[] = [];

  beforeAll(async () => {
    r2Default = createR2Client(readR2EnvOrThrow());
    // The endpoint reads from R2_BUCKET_EXTENSION_BUILDS, which integration
    // setup sets to a separate MinIO bucket. Provision it here so the test
    // run is self-bootstrapping.
    const buildsBucket = process.env.R2_BUCKET_EXTENSION_BUILDS ?? "remarks-extension-builds-test";
    r2Builds = withBucket(r2Default, buildsBucket);
    await ensureBucket(r2Builds);
    await getIntegrationDb();
    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    if (seededKeys.length > 0) {
      await deleteObjects(r2Builds, seededKeys);
    }
    await server.close();
    await closeIntegrationDb();
    r2Default.s3.destroy();
  });

  beforeEach(async () => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    await truncateAll();
  });

  function mockAuth(clerkUserId: string): void {
    mocks.verifyToken.mockResolvedValueOnce({ sub: clerkUserId });
    mocks.getOrganizationMembershipList.mockResolvedValueOnce({ data: [] });
  }

  async function seedRelease(args: {
    version: string;
    body: Buffer;
  }): Promise<{ key: string; sha256: string }> {
    const key = `releases/chrome/remarks-chrome-${args.version}.zip`;
    const sha256 = createHash("sha256").update(args.body).digest("hex");
    await putObject(r2Builds, {
      key,
      body: args.body,
      contentType: "application/zip",
    });
    seededKeys.push(key);

    const manifest = {
      version: args.version,
      sha256,
      sizeBytes: args.body.byteLength,
      uploadedAt: new Date().toISOString(),
      key,
    };
    await putObject(r2Builds, {
      key: MANIFEST_KEY,
      body: Buffer.from(JSON.stringify(manifest), "utf8"),
      contentType: "application/json",
    });
    seededKeys.push(MANIFEST_KEY);
    return { key, sha256 };
  }

  test("authed → 200 returns manifest fields and a URL that downloads the zip bytes", async () => {
    const db = await getIntegrationDb();
    const user = await seedUser(db);
    mockAuth(user.clerkUserId);

    const zipBody = Buffer.from("PKfake-extension-zip-body");
    const { sha256 } = await seedRelease({ version: "0.2.0", body: zipBody });

    const res = await server.inject({
      method: "GET",
      url: "/extension/latest",
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.version).toBe("0.2.0");
    expect(body.sha256).toBe(sha256);
    expect(body.sizeBytes).toBe(zipBody.byteLength);
    expect(typeof body.uploadedAt).toBe("string");
    expect(typeof body.downloadUrl).toBe("string");

    const dl = await fetch(body.downloadUrl);
    expect(dl.ok, `presigned GET failed: ${dl.status}`).toBe(true);
    const got = Buffer.from(await dl.arrayBuffer());
    expect(got.equals(zipBody)).toBe(true);
  });

  test("no manifest in bucket → 404 NOT_FOUND", async () => {
    const db = await getIntegrationDb();
    const user = await seedUser(db);
    mockAuth(user.clerkUserId);

    // Ensure a clean state: explicitly delete any manifest left from a prior
    // test before this one runs.
    await deleteObjects(r2Builds, [MANIFEST_KEY]);

    const res = await server.inject({
      method: "GET",
      url: "/extension/latest",
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  test("unauthenticated → 401 UNAUTHORIZED", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/extension/latest",
    });

    expect(res.statusCode).toBe(401);
  });
});
