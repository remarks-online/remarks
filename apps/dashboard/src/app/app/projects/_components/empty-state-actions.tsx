"use client";

import { useClerk } from "@clerk/nextjs";
import { Button } from "@remarks/ui";
import { Building2, FolderPlus, User } from "lucide-react";
import Link from "next/link";

export function EmptyStateActions({ hasOrg }: { hasOrg: boolean }) {
  const clerk = useClerk();

  return (
    <div className="mt-6 flex flex-wrap justify-center gap-2">
      <Button asChild>
        <Link href="/app/projects/new">
          <FolderPlus className="h-4 w-4" aria-hidden />
          Create project
        </Link>
      </Button>
      {hasOrg ? null : (
        <Button
          variant="outline"
          onClick={() =>
            clerk.openCreateOrganization({ afterCreateOrganizationUrl: "/app/projects" })
          }
        >
          <Building2 className="h-4 w-4" aria-hidden />
          Create organization
        </Button>
      )}
      <Button variant="ghost" asChild>
        <Link href="/app/personal">
          <User className="h-4 w-4" aria-hidden />
          View personal annotations
        </Link>
      </Button>
    </div>
  );
}
