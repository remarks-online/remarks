# Receiving Remarks webhooks

This runbook explains how to verify and consume outbound webhooks from Remarks. See ADR-0020 for the design rationale.

## Headers

Every delivery includes:

| Header | Meaning |
|---|---|
| `Content-Type` | `application/json` |
| `User-Agent` | `Remarks-Webhooks/1.0` |
| `Remarks-Event` | Event type, e.g. `annotation.created` |
| `Remarks-Delivery-Id` | UUID; same id is reused on retries of the same attempt row but each retry inserts a new row in our audit table |
| `Remarks-Signature` | `t=<unix_seconds>,v1=<hex_hmac_sha256>` |

## Body

```json
{
  "version": "1",
  "type": "annotation.created",
  "occurredAt": "2026-05-02T15:21:43.812Z",
  "data": { /* event-specific payload */ }
}
```

`occurredAt` is the timestamp of the source annotation event in Remarks; receivers should dedupe on `(type, occurredAt, annotationId)` to handle retries.

## Verifying the signature

The signature is computed as `HMAC-SHA256(secret, "${t}.${rawBody}")`. **Compare against the raw bytes of the request body**, not the parsed JSON.

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody: string, header: string, secret: string): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((kv) => kv.split("="))
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!t || !v1) return false;

  // Reject if the timestamp is outside a 5-minute window (replay protection).
  const skew = Math.abs(Math.floor(Date.now() / 1000) - t);
  if (skew > 5 * 60) return false;

  const expected = createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest("hex");
  if (expected.length !== v1.length) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(v1, "hex"));
}
```

## Retries

Inngest retries non-2xx responses up to 4 times with exponential backoff. To stop retries, return a 2xx (the delivery is recorded as succeeded). To request a faster retry on transient errors, return a 5xx; for permanent failures (bad payload), return a 4xx — Inngest still retries, but you can no-op subsequent attempts based on `Remarks-Delivery-Id` if you want to surface a single failure to your ops channel.

## Event taxonomy (v1)

| Event | When |
|---|---|
| `annotation.created` | A new annotation row is inserted |
| `annotation.status_changed` | `to_do` / `doing` / `done` / `rejected` / `acknowledged` transitions |
| `annotation.comment_added` | Agent added a comment via MCP |
| `annotation.resolved` | Synthetic — fires whenever a status transition lands on `done` |

A single source event may fan out to multiple webhook events (e.g. status change to `done` produces both `annotation.status_changed` and `annotation.resolved`). Subscribe only to what you need.

## Rotating the signing secret

Use the **Rotate secret** action in the project settings page. The new secret is shown once; existing receivers will fail verification on subsequent deliveries until updated. If you operate a critical integration, configure two webhooks pointing at the same receiver and roll one at a time.
