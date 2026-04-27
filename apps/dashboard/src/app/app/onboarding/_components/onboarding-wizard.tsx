"use client";

import { capture } from "@/lib/analytics";
import {
  type OnboardingResumeState,
  type OnboardingStep,
  clearResumeState,
  loadResumeState,
  saveResumeState,
  setSkipCookie,
} from "@/lib/onboarding-storage";
import { useUser } from "@clerk/nextjs";
import type { AnnotationResponse } from "@remarks/shared";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { StepFirstAnnotation } from "./step-first-annotation";
import { StepInstallExtension } from "./step-install-extension";
import { StepInstallMcp } from "./step-install-mcp";
import { StepSuccess } from "./step-success";
import { WizardShell } from "./wizard-shell";

interface WizardState {
  step: OnboardingStep;
  annotation: AnnotationResponse | null;
}

// Personal-first onboarding (no org/project required):
//   1. Install the browser extension
//   2. Capture a personal annotation
//   3. Connect an AI coding agent to the MCP server
//   "success" → links to /app/personal and /app/projects
//
// Resume state and skip cookie are keyed by userId only — onboarding is
// per-person, so creating or joining an org later doesn't re-trigger it.
export function OnboardingWizard() {
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const userId = user?.id ?? null;

  const [state, setState] = useState<WizardState>({ step: 1, annotation: null });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (hydrated || !isLoaded || !userId) return;
    const resumed = loadResumeState(userId);
    if (resumed) {
      setState({ step: resumed.step, annotation: null });
    }
    setHydrated(true);
    capture("onboarding_started", { entrypoint: "page" });
  }, [hydrated, isLoaded, userId]);

  useEffect(() => {
    if (!hydrated || !userId) return;
    const persistable: OnboardingResumeState = { step: state.step };
    saveResumeState(userId, persistable);
  }, [hydrated, userId, state.step]);

  const advanceFromInstall = useCallback((via: "auto" | "manual") => {
    capture("onboarding_step_completed", { step: 1, via });
    setState((prev) => ({ ...prev, step: 2 }));
  }, []);

  const advanceFromAnnotation = useCallback((annotation: AnnotationResponse) => {
    setState((prev) => ({ ...prev, step: 3, annotation }));
  }, []);

  const advanceFromMcp = useCallback((_agentId: string) => {
    setState((prev) => ({ ...prev, step: "success" }));
  }, []);

  const finish = useCallback(() => {
    if (!userId) return;
    setSkipCookie(userId);
    clearResumeState(userId);
    router.replace("/app/personal");
  }, [router, userId]);

  const handleSkip = useCallback(() => {
    if (!userId) return;
    capture("onboarding_skipped", { step: state.step });
    setSkipCookie(userId);
    clearResumeState(userId);
    router.replace("/app/projects");
  }, [router, state.step, userId]);

  // Fire `onboarding_completed` once we land on success; clear local state so
  // a future revisit at /app/onboarding starts fresh.
  useEffect(() => {
    if (state.step !== "success") return;
    capture("onboarding_completed", {});
    if (userId) {
      setSkipCookie(userId);
      clearResumeState(userId);
    }
  }, [state.step, userId]);

  if (!hydrated) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div className="h-7 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 w-full animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  if (state.step === 1) {
    return (
      <WizardShell
        step={1}
        title="Install the Remarks extension"
        description="The extension is how you capture annotations on any page. We'll auto-advance the moment we detect it in your browser."
        onSkip={handleSkip}
      >
        <StepInstallExtension onAdvance={advanceFromInstall} />
      </WizardShell>
    );
  }

  if (state.step === 2) {
    return (
      <WizardShell
        step={2}
        title="Capture your first annotation"
        description="Open any page, click the Remarks icon, and leave a comment on something you want to fix or remember."
        onSkip={handleSkip}
      >
        <StepFirstAnnotation onAnnotationCaptured={advanceFromAnnotation} onSkip={handleSkip} />
      </WizardShell>
    );
  }

  if (state.step === 3) {
    return (
      <WizardShell
        step={3}
        title="Connect an AI agent (optional)"
        description="Hand your captured tasks off to Claude Code, Cursor, or any MCP-compatible client so it can pick them up and ship the fixes."
        onSkip={handleSkip}
      >
        <StepInstallMcp onAdvance={advanceFromMcp} onSkip={handleSkip} />
      </WizardShell>
    );
  }

  return (
    <WizardShell
      step="success"
      title="Welcome to Remarks"
      description="You're set up. Here's where to go next."
      onSkip={finish}
    >
      <StepSuccess annotation={state.annotation} />
    </WizardShell>
  );
}
