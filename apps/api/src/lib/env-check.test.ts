import { describe, expect, test } from "vitest";
import { z } from "zod";
import { findMissingKeys, parseFlyTomlEnvKeys, requiredEnvKeys } from "./env-check.js";

describe("requiredEnvKeys", () => {
  test("returns only keys that reject undefined", () => {
    const schema = z.object({
      REQUIRED_URL: z.string().url(),
      REQUIRED_PREFIX: z.string().startsWith("sk_"),
      HAS_DEFAULT: z.string().default("x"),
      COERCED_WITH_DEFAULT: z.coerce.number().default(3000),
      OPTIONAL: z.string().optional(),
      ENUM_REQUIRED: z.enum(["a", "b"]),
    });
    expect(requiredEnvKeys(schema)).toEqual(["ENUM_REQUIRED", "REQUIRED_PREFIX", "REQUIRED_URL"]);
  });

  test("returns empty when every key has a default or is optional", () => {
    const schema = z.object({
      A: z.string().default("x"),
      B: z.string().optional(),
    });
    expect(requiredEnvKeys(schema)).toEqual([]);
  });
});

describe("parseFlyTomlEnvKeys", () => {
  test("extracts keys from the [env] block", () => {
    const toml = `
app = "remarks-api"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  PORT = "3000"
  LOG_LEVEL = "info"

[http_service]
  internal_port = 3000
`;
    expect(parseFlyTomlEnvKeys(toml)).toEqual(new Set(["NODE_ENV", "PORT", "LOG_LEVEL"]));
  });

  test("returns an empty set when [env] is absent", () => {
    const toml = `app = "x"\n[build]\n  dockerfile = "Dockerfile"\n`;
    expect(parseFlyTomlEnvKeys(toml)).toEqual(new Set());
  });

  test("ignores blank lines and comments inside [env]", () => {
    const toml = `[env]\n  # a comment\n\n  FOO = "bar"\n  BAZ = 1\n`;
    expect(parseFlyTomlEnvKeys(toml)).toEqual(new Set(["FOO", "BAZ"]));
  });

  test("stops at the next section header", () => {
    const toml = `[env]\n  A = "1"\n[http_service]\n  B = "2"\n`;
    expect(parseFlyTomlEnvKeys(toml)).toEqual(new Set(["A"]));
  });
});

describe("findMissingKeys", () => {
  test("flags keys present in neither source", () => {
    const missing = findMissingKeys(
      ["DATABASE_URL", "CLERK_SECRET_KEY", "CLERK_WEBHOOK_SECRET", "LOG_LEVEL"],
      new Set(["LOG_LEVEL", "NODE_ENV"]),
      new Set(["DATABASE_URL", "CLERK_WEBHOOK_SECRET"])
    );
    expect(missing).toEqual(["CLERK_SECRET_KEY"]);
  });

  test("returns an empty array when all required keys are provided", () => {
    const missing = findMissingKeys(["A", "B"], new Set(["A"]), new Set(["B"]));
    expect(missing).toEqual([]);
  });
});
