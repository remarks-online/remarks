import type { AppRouter } from "@remarks/api/trpc/router";
import { createTRPCReact } from "@trpc/react-query";

export const trpc = createTRPCReact<AppRouter>();
