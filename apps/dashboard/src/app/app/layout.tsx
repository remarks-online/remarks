import { PostHogProvider } from "@/components/posthog-provider";
import { TRPCProvider } from "@/lib/trpc-provider";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <TRPCProvider>
      <PostHogProvider>
        <div className="flex min-h-screen flex-col bg-background text-foreground">
          <header className="flex items-center justify-between border-b border-border px-6 py-3">
            <Link href="/app/projects" className="text-lg font-semibold">
              Remarks
            </Link>
            <div className="flex items-center gap-4">
              <Link
                href="/app/personal"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Personal
              </Link>
              <Link
                href="/app/connect-agent"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Connect agent
              </Link>
              <OrganizationSwitcher
                afterSelectOrganizationUrl="/app/projects"
                afterCreateOrganizationUrl="/app/projects"
                afterLeaveOrganizationUrl="/app/personal"
              />
              <UserButton />
            </div>
          </header>
          <div className="flex-1 px-6 py-8">{children}</div>
        </div>
      </PostHogProvider>
    </TRPCProvider>
  );
}
