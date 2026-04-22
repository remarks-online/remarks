import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Local dev uses .env.local per CLAUDE.md §1.8; fall back to .env if present.
config({ path: [".env.local", ".env"] });

// `generate` only diffs the schema files and doesn't connect; `push`/`migrate`/
// `studio`/`pull` do. Only require DATABASE_URL for commands that need it.
const cmd = process.argv[2];
const CONNECT_COMMANDS = new Set(["push", "migrate", "studio", "pull", "introspect"]);
const url = process.env.DATABASE_URL;
if (!url && cmd && CONNECT_COMMANDS.has(cmd)) {
  throw new Error(`DATABASE_URL is required for drizzle-kit ${cmd}`);
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: url ?? "" },
  strict: true,
  verbose: true,
});
