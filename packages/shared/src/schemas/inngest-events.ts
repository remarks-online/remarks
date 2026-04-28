import { z } from "zod";

// Inngest event names use the `remarks/` prefix to keep them namespaced from
// any third-party events that may show up in shared environments.
export const INNGEST_EVENT_NAMES = ["remarks/r2.cleanup.requested"] as const;
export type InngestEventName = (typeof INNGEST_EVENT_NAMES)[number];

// Each `keys` array maps to one S3 DeleteObjects call. The handler will not
// chunk further, so callers must split into batches of <=1000 keys (the S3
// API ceiling) and <=256KB serialized (the Inngest event payload ceiling).
// 500 keys ~= 25KB at typical R2 key length, well under both.
export const r2CleanupRequestedDataSchema = z.object({
  keys: z.array(z.string().min(1)).min(1).max(1000),
  // Free-form origin tag for log correlation: "annotation:<id>",
  // "project:<id>", "org:<clerkOrgId>". Not parsed — only logged.
  origin: z.string().min(1),
});
export type R2CleanupRequestedData = z.infer<typeof r2CleanupRequestedDataSchema>;

// Single typed map consumed by `new EventSchemas().fromRecord(...)` in the
// Inngest client. Declared as a `type` (not `interface`) so it satisfies
// Inngest's `Record<string, ...>` constraint — interfaces don't pick up an
// implicit string index signature. Keep this file dependency-free (no
// `inngest` import) so the dashboard package can reuse it for tRPC type
// inference without pulling the SDK into the browser bundle.
export type InngestEvents = {
  "remarks/r2.cleanup.requested": {
    data: R2CleanupRequestedData;
  };
};
