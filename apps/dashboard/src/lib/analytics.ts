"use client";

import posthog, { type PostHog } from "posthog-js";

// Spec §7.5 enumerates the events the dashboard captures. Adding a new event
// name here is the contract — keep this list in sync with §7.5.
export type AnalyticsEvent =
  | "onboarding_started"
  | "onboarding_step_completed"
  | "onboarding_skipped"
  | "onboarding_completed"
  | "extension_installed"
  | "extension_signed_in"
  | "project_created"
  | "org_created"
  | "annotation_created"
  | "annotation_status_changed";

// Read NEXT_PUBLIC_* directly. The full server `env.ts` validates secrets
// (CLERK_SECRET_KEY, etc.) which Next.js strips from the client bundle —
// importing it from a "use client" module crashes the browser at module load.
// At build time Next.js inlines these into the client bundle.
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

let initialized = false;

export function initAnalytics(): PostHog | null {
  if (typeof window === "undefined") return null;
  if (!POSTHOG_KEY) return null;
  if (initialized) return posthog;

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    // Spec §7.5 events are explicit; autocapture would just add noise.
    autocapture: false,
    capture_pageview: true,
    capture_pageleave: true,
    person_profiles: "identified_only",
    loaded: () => {
      initialized = true;
    },
  });
  initialized = true;
  return posthog;
}

export function identifyUser(
  userId: string,
  traits?: { email?: string; name?: string; orgId?: string | null }
): void {
  if (!initialized || !POSTHOG_KEY) return;
  posthog.identify(userId, {
    ...(traits?.email ? { email: traits.email } : {}),
    ...(traits?.name ? { name: traits.name } : {}),
    ...(traits?.orgId ? { activeOrgId: traits.orgId } : {}),
  });
}

export function resetAnalytics(): void {
  if (!initialized || !POSTHOG_KEY) return;
  posthog.reset();
}

export function capture(event: AnalyticsEvent, properties?: Record<string, unknown>): void {
  if (!initialized || !POSTHOG_KEY) return;
  posthog.capture(event, properties);
}
