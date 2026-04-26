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
import { trpc } from "@/lib/trpc-client";
import { useUser } from "@clerk/nextjs";
import type { AnnotationResponse } from "@remarks/shared";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StepCreateProject } from "./step-create-project";
import { StepFirstAnnotation } from "./step-first-annotation";
import { StepInstallExtension } from "./step-install-extension";
import { StepSuccess } from "./step-success";
import { WizardShell } from "./wizard-shell";

interface Props {
  orgId: string;
}

interface WizardState {
  step: OnboardingStep;
  project: { id: string; slug: string; name: string } | null;
  annotation: AnnotationResponse | null;
}

export function OnboardingWizard({ orgId }: Props) {
  const router = useRouter();
  const { user } = useUser();
  const userId = user?.id ?? null;

  // Pull existing projects so we can auto-skip step 1 for users who already
  // have one (revisits, post-create-flow visits, teammates landing here).
  const projectsQuery = trpc.projects.list.useQuery({ orgId });
  const existingMostRecent = useMemo(() => {
    const items = projectsQuery.data?.items ?? [];
    if (items.length === 0) return null;
    // Server returns projects ordered by createdAt DESC (see project.service).
    const head = items[0];
    if (!head) return null;
    return { id: head.id, slug: head.slug, name: head.name };
  }, [projectsQuery.data]);

  const [state, setState] = useState<WizardState>({
    step: 1,
    project: null,
    annotation: null,
  });
  const [hydrated, setHydrated] = useState(false);

  // Hydrate once `useUser` resolves — we need both userId+orgId for the
  // resume-key namespace. Without this guard the wizard flickers on initial
  // render against an unkeyed cache.
  useEffect(() => {
    if (hydrated || !userId) return;
    const resumed = loadResumeState(userId, orgId);
    if (resumed) {
      setState({ step: resumed.step, project: resumed.project, annotation: null });
      setHydrated(true);
      return;
    }
    // No saved state: if the user already has a project, jump past step 1.
    if (existingMostRecent) {
      setState({ step: 2, project: existingMostRecent, annotation: null });
    } else if (projectsQuery.isFetched) {
      // Only after the projects query has resolved do we know we should sit on
      // step 1 — otherwise we'd briefly show step 1 and then jump.
      setState({ step: 1, project: null, annotation: null });
    } else {
      return;
    }
    setHydrated(true);
    capture("onboarding_started", { entrypoint: "page" });
  }, [hydrated, userId, orgId, existingMostRecent, projectsQuery.isFetched]);

  // Persist on every step change so a refresh resumes correctly.
  useEffect(() => {
    if (!hydrated || !userId) return;
    const persistable: OnboardingResumeState = {
      step: state.step,
      project: state.project,
    };
    saveResumeState(userId, orgId, persistable);
  }, [hydrated, userId, orgId, state.step, state.project]);

  const advanceFromCreate = useCallback((project: { id: string; slug: string; name: string }) => {
    capture("onboarding_step_completed", { step: 1, projectId: project.id });
    setState((prev) => ({ ...prev, step: 2, project }));
  }, []);

  const advanceFromInstall = useCallback((via: "auto" | "manual", _version?: string) => {
    capture("onboarding_step_completed", { step: 2, via });
    setState((prev) => ({ ...prev, step: 3 }));
  }, []);

  const advanceFromAnnotation = useCallback((annotation: AnnotationResponse) => {
    setState((prev) => ({ ...prev, step: "success", annotation }));
  }, []);

  const handleSkip = useCallback(() => {
    if (!userId) return;
    capture("onboarding_skipped", { step: state.step });
    setSkipCookie(userId, orgId);
    clearResumeState(userId, orgId);
    router.replace("/app/projects");
  }, [orgId, router, state.step, userId]);

  // Fire `onboarding_completed` once we land on success; clear local state so
  // a future revisit at /app/onboarding starts fresh (e.g. to walk a teammate).
  useEffect(() => {
    if (state.step !== "success") return;
    capture("onboarding_completed", { projectId: state.project?.id ?? null });
    if (userId) clearResumeState(userId, orgId);
  }, [state.step, state.project, userId, orgId]);

  // Defensive reset: any post-step-1 step requires a project. If we land in an
  // inconsistent state (resume corruption, project deleted, etc.) snap back to
  // step 1. Effect rather than setState-in-render to avoid React's warning.
  useEffect(() => {
    if ((state.step === 2 || state.step === 3 || state.step === "success") && !state.project) {
      setState({ step: 1, project: null, annotation: null });
    }
  }, [state.step, state.project]);

  if (!hydrated || projectsQuery.isLoading) {
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
        title="Create your first project"
        description="Projects group annotations captured on a single site or staging environment. You can rename or delete it later."
        onSkip={handleSkip}
      >
        <StepCreateProject orgId={orgId} onProjectCreated={advanceFromCreate} />
      </WizardShell>
    );
  }

  // Steps 2/3/success all need a project. Render nothing until the defensive
  // effect runs (one tick) so we don't crash on null.
  if (!state.project) return null;

  if (state.step === 2) {
    return (
      <WizardShell
        step={2}
        title="Install the Remarks extension"
        description="The extension is how you capture annotations. We'll auto-advance the moment we detect it in your browser."
        onSkip={handleSkip}
      >
        <StepInstallExtension onAdvance={advanceFromInstall} />
      </WizardShell>
    );
  }

  if (state.step === 3) {
    return (
      <WizardShell
        step={3}
        title="Capture your first annotation"
        description="Open the page you want to annotate, click the Remarks icon, and pick an element."
        onSkip={handleSkip}
      >
        <StepFirstAnnotation
          project={state.project}
          onAnnotationCaptured={advanceFromAnnotation}
          onSkip={handleSkip}
        />
      </WizardShell>
    );
  }

  return (
    <WizardShell
      step="success"
      title="Welcome to Remarks"
      description="You're set up. Invite your team or jump back into the project."
      onSkip={handleSkip}
    >
      <StepSuccess project={state.project} annotation={state.annotation} />
    </WizardShell>
  );
}
