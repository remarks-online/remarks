import { envSchema } from "./env-schema.js";

export { envSchema } from "./env-schema.js";
export type { Env } from "./env-schema.js";
export const env = envSchema.parse(process.env);
