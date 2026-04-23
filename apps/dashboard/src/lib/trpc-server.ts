import { auth } from "@clerk/nextjs/server";
import type { AppRouter } from "@remarks/api/trpc/router";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { env } from "../env";

export async function getTrpcServer() {
  const { getToken } = await auth();
  const token = await getToken();

  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${env.NEXT_PUBLIC_API_BASE_URL}/trpc`,
        headers: () => (token ? { authorization: `Bearer ${token}` } : {}),
      }),
    ],
  });
}
