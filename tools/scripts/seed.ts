/**
 * Dev seed script.
 *
 * Populates the configured Postgres with an org, user, project, branches, and
 * annotations so the dashboard project-detail page can be exercised end-to-end
 * without the extension.
 *
 * Requires:
 *   DATABASE_URL
 *   DEV_SEED_CLERK_ORG_ID   (paste from Clerk dashboard — matches your signed-in org)
 *   DEV_SEED_CLERK_USER_ID  (paste from Clerk dashboard — matches your signed-in user)
 *
 * Optional (when set, one annotation gets a real screenshot asset in R2/MinIO):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *   R2_BUCKET_SCREENSHOTS, R2_S3_ENDPOINT
 *
 * Idempotent: re-running skips inserts that already exist.
 */
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient, schema } from "@remarks/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const SEED_ORG_SLUG = "demo-org";
const SEED_PROJECT_SLUG = "demo";
const SEED_PROJECT_NAME = "Demo Project";
const SEED_BRANCHES = ["main", "feature/checkout-redesign", "feature/nav-update"] as const;

// 1×1 gray PNG — enough to exercise the R2 GET path and render as <img>.
// Generated with: `printf '\x89PNG...'` then base64'd.
const PLACEHOLDER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  DEV_SEED_CLERK_ORG_ID: z.string().min(1),
  DEV_SEED_CLERK_USER_ID: z.string().min(1),
  DEV_SEED_USER_EMAIL: z.string().email().default("dev-seed@example.com"),
  DEV_SEED_USER_NAME: z.string().default("Dev Seed"),
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET_SCREENSHOTS: z.string().min(1).optional(),
  R2_S3_ENDPOINT: z.string().url().optional(),
});

function readEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (parsed.success) return parsed.data;

  // Render a helpful message listing exactly what's missing. Seed is a dev
  // tool, so the failure path needs to tell the user how to fix their shell.
  const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
  console.error(
    `pnpm seed: missing or invalid env vars (${missing}).

Required:
  DATABASE_URL
  DEV_SEED_CLERK_ORG_ID   (from Clerk dashboard — your signed-in org)
  DEV_SEED_CLERK_USER_ID  (from Clerk dashboard — your signed-in user)

Optional (enables screenshot assets):
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
  R2_BUCKET_SCREENSHOTS, R2_S3_ENDPOINT
`
  );
  process.exit(1);
}

type Env = z.infer<typeof envSchema>;

function hasR2(env: Env): env is Env & {
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_SCREENSHOTS: string;
} {
  return Boolean(
    env.R2_ACCOUNT_ID &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY &&
      env.R2_BUCKET_SCREENSHOTS
  );
}

async function main(): Promise<void> {
  const env = readEnv();
  const client = createClient(env.DATABASE_URL);
  const db = client.db;

  try {
    // Org — keyed on clerkOrgId so a dev with a Clerk org already has a row
    // after Clerk's webhook sync; if so, we reuse it rather than insert.
    let org = await db.query.organizations.findFirst({
      where: eq(schema.organizations.clerkOrgId, env.DEV_SEED_CLERK_ORG_ID),
    });
    if (!org) {
      const [inserted] = await db
        .insert(schema.organizations)
        .values({
          clerkOrgId: env.DEV_SEED_CLERK_ORG_ID,
          name: "Demo Org",
          slug: SEED_ORG_SLUG,
        })
        .returning();
      if (!inserted) throw new Error("org insert returned no rows");
      org = inserted;
      console.log(`  + organizations: inserted ${org.id} (${org.clerkOrgId})`);
    } else {
      console.log(`  = organizations: reusing ${org.id} (${org.clerkOrgId})`);
    }

    // User — same pattern.
    let user = await db.query.users.findFirst({
      where: eq(schema.users.clerkUserId, env.DEV_SEED_CLERK_USER_ID),
    });
    if (!user) {
      const [inserted] = await db
        .insert(schema.users)
        .values({
          clerkUserId: env.DEV_SEED_CLERK_USER_ID,
          email: env.DEV_SEED_USER_EMAIL,
          name: env.DEV_SEED_USER_NAME,
        })
        .returning();
      if (!inserted) throw new Error("user insert returned no rows");
      user = inserted;
      console.log(`  + users: inserted ${user.id} (${user.clerkUserId})`);
    } else {
      console.log(`  = users: reusing ${user.id} (${user.clerkUserId})`);
    }

    // Project — keyed on (orgId, slug) per the unique index.
    let project = await db.query.projects.findFirst({
      where: and(eq(schema.projects.orgId, org.id), eq(schema.projects.slug, SEED_PROJECT_SLUG)),
    });
    if (!project) {
      const [inserted] = await db
        .insert(schema.projects)
        .values({
          orgId: org.id,
          name: SEED_PROJECT_NAME,
          slug: SEED_PROJECT_SLUG,
          primaryBranch: "main",
        })
        .returning();
      if (!inserted) throw new Error("project insert returned no rows");
      project = inserted;
      console.log(`  + projects: inserted ${project.id}`);
    } else {
      console.log(`  = projects: reusing ${project.id}`);
    }

    // Project membership.
    const member = await db.query.projectMembers.findFirst({
      where: and(
        eq(schema.projectMembers.projectId, project.id),
        eq(schema.projectMembers.userId, user.id)
      ),
    });
    if (!member) {
      await db.insert(schema.projectMembers).values({
        projectId: project.id,
        userId: user.id,
        role: "admin",
      });
      console.log(`  + project_members: inserted ${user.id} as admin`);
    } else {
      console.log(`  = project_members: reusing role=${member.role}`);
    }

    // Branches — keyed on (projectId, name).
    const branchIds = new Map<string, string>();
    for (const name of SEED_BRANCHES) {
      const existing = await db.query.branches.findFirst({
        where: and(eq(schema.branches.projectId, project.id), eq(schema.branches.name, name)),
        columns: { id: true },
      });
      if (existing) {
        branchIds.set(name, existing.id);
        continue;
      }
      const [inserted] = await db
        .insert(schema.branches)
        .values({ projectId: project.id, name })
        .returning({ id: schema.branches.id });
      if (!inserted) throw new Error(`branch insert returned no rows for ${name}`);
      branchIds.set(name, inserted.id);
      console.log(`  + branches: inserted ${name}`);
    }

    // Annotations — idempotency via authorId + commentText + branchId tuple
    // lookup, since no unique index exists. The fixed comment texts below
    // double as stable keys.
    interface AnnotationSpec {
      commentText: string;
      branch: (typeof SEED_BRANCHES)[number];
      status: "to_do" | "doing" | "done" | "rejected";
      url: string;
      targetType: "element" | "rectangle" | "route";
      targetSelector?: string;
      targetCoords?: { x: number; y: number; width: number; height: number };
      withScreenshot?: boolean;
    }
    const specs: AnnotationSpec[] = [
      {
        commentText: "Make the primary CTA use brand green, not purple",
        branch: "main",
        status: "to_do",
        url: "https://staging.acme.com/",
        targetType: "element",
        targetSelector: "main > section:nth-child(1) > a.cta",
        withScreenshot: true,
      },
      {
        commentText: "Hero copy should mention the new pricing tier",
        branch: "main",
        status: "doing",
        url: "https://staging.acme.com/",
        targetType: "element",
        targetSelector: "h1.hero__title",
      },
      {
        commentText: "Footer link to /status is dead — 404",
        branch: "main",
        status: "done",
        url: "https://staging.acme.com/",
        targetType: "element",
        targetSelector: "footer a[href='/status']",
      },
      {
        commentText: "Checkout form loses focus when the coupon field appears",
        branch: "feature/checkout-redesign",
        status: "to_do",
        url: "https://staging.acme.com/checkout",
        targetType: "rectangle",
        targetCoords: { x: 240, y: 480, width: 560, height: 180 },
      },
      {
        commentText: "Order summary total is inconsistent with cart subtotal",
        branch: "feature/checkout-redesign",
        status: "doing",
        url: "https://staging.acme.com/checkout",
        targetType: "element",
        targetSelector: "aside.order-summary dl.total",
      },
      {
        commentText: "Place-order button is not disabled during submission",
        branch: "feature/checkout-redesign",
        status: "rejected",
        url: "https://staging.acme.com/checkout",
        targetType: "element",
        targetSelector: "form button.submit",
      },
      {
        commentText: "Mobile nav overlaps the skip link on first paint",
        branch: "feature/nav-update",
        status: "to_do",
        url: "https://staging.acme.com/about",
        targetType: "route",
      },
      {
        commentText: "Active state on the nav items is too subtle against the new bg",
        branch: "feature/nav-update",
        status: "done",
        url: "https://staging.acme.com/pricing",
        targetType: "element",
        targetSelector: "header nav a[aria-current='page']",
      },
    ];

    const base = new Date("2026-04-01T12:00:00.000Z").getTime();
    let shouldUploadScreenshot = hasR2(env);
    if (!shouldUploadScreenshot) {
      console.log(
        "  ! R2 env not configured — skipping screenshot uploads. Annotation assets will be absent."
      );
    }
    const r2 = shouldUploadScreenshot
      ? new S3Client({
          region: "auto",
          endpoint: env.R2_S3_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
          forcePathStyle: true,
          credentials: {
            accessKeyId: env.R2_ACCESS_KEY_ID ?? "",
            secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "",
          },
        })
      : null;

    for (let i = 0; i < specs.length; i += 1) {
      const spec = specs[i];
      if (!spec) continue;
      const branchId = branchIds.get(spec.branch);
      if (!branchId) throw new Error(`branchId missing for ${spec.branch}`);

      const existing = await db.query.annotations.findFirst({
        where: and(
          eq(schema.annotations.projectId, project.id),
          eq(schema.annotations.authorId, user.id),
          eq(schema.annotations.commentText, spec.commentText)
        ),
        columns: { id: true },
      });
      if (existing) {
        console.log(`  = annotations: reusing ${spec.commentText.slice(0, 32)}…`);
        continue;
      }

      const createdAt = new Date(base + i * 60 * 1000);
      const [inserted] = await db
        .insert(schema.annotations)
        .values({
          projectId: project.id,
          branchId,
          authorId: user.id,
          status: spec.status,
          targetType: spec.targetType,
          url: spec.url,
          targetSelector: spec.targetSelector ?? null,
          targetCoords: spec.targetCoords ?? null,
          viewport: { width: 1440, height: 900, dpr: 2 },
          commentText: spec.commentText,
          createdAt,
          updatedAt: createdAt,
        })
        .returning({ id: schema.annotations.id });
      if (!inserted) throw new Error("annotation insert returned no rows");

      await db.insert(schema.annotationEvents).values({
        annotationId: inserted.id,
        actorType: "user",
        actorId: user.id,
        type: "created",
        payload: {},
      });

      if (spec.withScreenshot && r2 && hasR2(env)) {
        const assetId = crypto.randomUUID();
        const key = `projects/${project.id}/screenshot/${assetId}`;
        const body = Buffer.from(PLACEHOLDER_PNG_BASE64, "base64");
        try {
          await r2.send(
            new PutObjectCommand({
              Bucket: env.R2_BUCKET_SCREENSHOTS,
              Key: key,
              Body: body,
              ContentType: "image/png",
            })
          );
          await db.insert(schema.annotationAssets).values({
            id: assetId,
            annotationId: inserted.id,
            kind: "screenshot",
            r2Key: key,
            contentType: "image/png",
            sizeBytes: body.byteLength,
          });
          console.log(
            `  + annotations: inserted + screenshot for "${spec.commentText.slice(0, 32)}…"`
          );
        } catch (err) {
          // R2 unreachable → keep the annotation row but drop this attempt.
          // Running the seed again will retry the upload.
          shouldUploadScreenshot = false;
          console.log(
            `  ! R2 upload failed (${(err as Error).message}) — annotation created without asset`
          );
        }
      } else {
        console.log(`  + annotations: inserted "${spec.commentText.slice(0, 32)}…"`);
      }
    }

    if (r2) r2.destroy();
    console.log("\nseed complete.");
  } finally {
    await client.sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
