"use client";

// Local persistence for the onboarding wizard. Keyed by `<userId>:<orgId>` so
// switching orgs (or users) gives a fresh resume slate without us having to
// reason about clearing on sign-out — `resetAnalytics()` and Clerk handle the
// session, and a different scope key just makes the previous state invisible.

export type OnboardingStep = 1 | 2 | 3 | "success";

export interface OnboardingResumeState {
  step: OnboardingStep;
  project: { id: string; slug: string; name: string } | null;
}

const RESUME_PREFIX = "remarks-onboarding:";
const SKIP_COOKIE_PREFIX = "remarks-onboarding-skipped:";

function resumeKey(userId: string, orgId: string): string {
  return `${RESUME_PREFIX}${userId}:${orgId}`;
}

export function loadResumeState(userId: string, orgId: string): OnboardingResumeState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(resumeKey(userId, orgId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OnboardingResumeState;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed.step === 1 || parsed.step === 2 || parsed.step === 3 || parsed.step === "success")
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveResumeState(userId: string, orgId: string, state: OnboardingResumeState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(resumeKey(userId, orgId), JSON.stringify(state));
  } catch {
    // Quota / disabled storage — losing resume state is fine, the wizard
    // restarts at step 1.
  }
}

export function clearResumeState(userId: string, orgId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(resumeKey(userId, orgId));
  } catch {
    // ignored
  }
}

// The skip flag lives in a cookie because /app's redirect runs server-side
// and needs a sync read. Keyed the same way as the resume state so two users
// on the same browser don't share each other's skip preference.
export function setSkipCookie(userId: string, orgId: string): void {
  if (typeof document === "undefined") return;
  const value = `${SKIP_COOKIE_PREFIX}${userId}:${orgId}=1`;
  // 1-year TTL, root path, secure on HTTPS.
  const isSecure = window.location.protocol === "https:";
  document.cookie = `${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax${
    isSecure ? "; secure" : ""
  }`;
}

export function buildSkipCookieName(userId: string, orgId: string): string {
  return `${SKIP_COOKIE_PREFIX}${userId}:${orgId}`;
}
