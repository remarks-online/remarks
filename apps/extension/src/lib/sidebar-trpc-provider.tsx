import { env } from "@/env";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { type ReactNode, useMemo, useState } from "react";
import { trpc } from "./trpc";

/**
 * Content-script-scope tRPC provider. Differs from the popup's `TrpcProvider`
 * (which uses `useAuth().getToken()` from `@clerk/chrome-extension`) because
 * ClerkProvider doesn't run in the shadow root. The Bearer token here is the
 * Clerk `__session` cookie value, surfaced by the background `auth-status`
 * handler — see `auth-status.ts` and `background.ts`.
 */
export function SidebarTrpcProvider({
  token,
  children,
}: {
  token: string | null;
  children: ReactNode;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 5_000 },
          mutations: { retry: 0 },
        },
      })
  );

  // Re-create the tRPC client when the token changes so subsequent requests
  // reflect the refreshed cookie. TanStack Query caches survive across client
  // swaps because they live on the QueryClient, not the trpc instance.
  const trpcClient = useMemo(
    () =>
      trpc.createClient({
        links: [
          httpBatchLink({
            url: `${env.WXT_API_URL}/trpc`,
            headers: () => (token ? { authorization: `Bearer ${token}` } : {}),
          }),
        ],
      }),
    [token]
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
