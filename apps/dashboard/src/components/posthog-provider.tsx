"use client";

import { identifyUser, initAnalytics, resetAnalytics } from "@/lib/analytics";
import { useUser } from "@clerk/nextjs";
import { type ReactNode, useEffect } from "react";

export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    initAnalytics();
  }, []);

  const { isLoaded, isSignedIn, user } = useUser();

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn || !user) {
      resetAnalytics();
      return;
    }
    const email = user.primaryEmailAddress?.emailAddress;
    const name = user.fullName;
    const orgId = user.organizationMemberships[0]?.organization.id ?? null;
    identifyUser(user.id, {
      ...(email ? { email } : {}),
      ...(name ? { name } : {}),
      orgId,
    });
  }, [isLoaded, isSignedIn, user]);

  return <>{children}</>;
}
