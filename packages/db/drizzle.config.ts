import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Local dev uses .env.local per CLAUDE.md §1.8; fall back to .env if present.
config({ path: [".env.local", ".env"] });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required for drizzle-kit commands");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
