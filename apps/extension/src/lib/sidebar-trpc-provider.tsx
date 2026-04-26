import { env } from "@/env";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { type ReactNode, useEffect, useRef, useState } from "react";
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

  // Stable client; the headers function reads the latest token from a ref so
  // a refreshed cookie takes effect on the next request without resubscribing
  // every in-flight query (which would bounce them back into `isPending`).
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${env.WXT_API_URL}/trpc`,
          headers: () => {
            const t = tokenRef.current;
            return t ? { authorization: `Bearer ${t}` } : {};
          },
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
