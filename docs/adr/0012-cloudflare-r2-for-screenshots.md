# 0012. Cloudflare R2 for screenshots

Date: 2026-04-21
Status: Accepted

## Context

Every annotation can include a screenshot, and screenshots are the heaviest asset we store — often several hundred kilobytes each, occasionally megabytes for full-page captures. Storing them in Postgres is wrong (bloats the DB, makes backups painful, can't be served directly to the browser). We need an object store with (a) presigned uploads so the extension PUTs directly to the bucket without proxying through our API, (b) presigned downloads with short TTLs so screenshot URLs don't leak permanently, and (c) zero egress charges so we can display screenshots in the dashboard without a surprise bill.

## Decision

Use **Cloudflare R2** for all binary assets: screenshots, eventually video captures, and any other uploaded files. Buckets are `remarks-screenshots-prod` and `remarks-screenshots-dev`. The API issues presigned PUT URLs (`POST /uploads/presign`) that the extension uses to upload directly; download URLs are presigned with a 1-hour TTL and regenerated on each dashboard request. R2 access is entirely through the API — no public buckets, ever.

## Consequences

**Zero egress cost** is the critical win: every screenshot viewed in the dashboard is free bandwidth. S3-compatible API means we can use the AWS SDK directly. Presigned URLs keep the upload off our API's hot path. We accept that R2 has slightly fewer features than S3 (no Glacier tier, less mature replication), none of which matter for our workload.

## Alternatives considered

**AWS S3** — the incumbent, but egress charges would dominate our bill as the dashboard gets used. **Backblaze B2** — cheap but higher latency than R2 and less integrated with the rest of our Cloudflare DNS setup. **Upload via API (no presigning), store in R2** — simpler but makes our API a bottleneck for large uploads. **Store in Postgres as bytea** — objectively wrong; see Context.
