"use client";

import type { OnboardingStep } from "@/lib/onboarding-storage";
import { Button } from "@remarks/ui";
import type { ReactNode } from "react";

interface WizardShellProps {
  step: OnboardingStep;
  title: string;
  description: string;
  onSkip: () => void;
  children: ReactNode;
}

const NUMERIC_STEPS = [1, 2, 3] as const;

export function WizardShell({ step, title, description, onSkip, children }: WizardShellProps) {
  const stepIndex = step === "success" ? 4 : step;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2" aria-label="Onboarding progress">
          {NUMERIC_STEPS.map((n) => {
            const status = stepIndex > n ? "done" : stepIndex === n ? "active" : "todo";
            const chipColors =
              status === "done"
                ? "border-primary bg-primary text-primary-foreground"
                : status === "active"
                  ? "border-primary bg-background text-primary"
                  : "border-border bg-muted text-muted-foreground";
            return (
              <div key={n} className="flex items-center gap-2">
                <div
                  data-status={status}
                  className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium ${chipColors}`}
                >
                  {status === "done" ? "✓" : n}
                </div>
                {n < 3 ? <div className="h-px w-8 bg-border" /> : null}
              </div>
            );
          })}
        </div>
        {step !== "success" ? (
          <Button variant="ghost" size="sm" onClick={onSkip}>
            Skip onboarding
          </Button>
        ) : null}
      </div>

      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </div>

      <div>{children}</div>
    </div>
  );
}
