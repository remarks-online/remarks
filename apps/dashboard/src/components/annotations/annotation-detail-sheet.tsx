"use client";

import { trpc } from "@/lib/trpc-client";
import {
  MAX_COMMENT_LENGTH,
  MAX_REJECTION_REASON_LENGTH,
  MIN_REJECTION_REASON_LENGTH,
} from "@remarks/shared";
import type { AnnotationResponse } from "@remarks/shared";
import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetTitle,
  Textarea,
} from "@remarks/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EventRow } from "./event-row";
import {
  INTENT_LABEL,
  INTENT_OPTIONS,
  INTENT_VARIANT,
  SEVERITY_LABEL,
  SEVERITY_OPTIONS,
  SEVERITY_VARIANT,
  STATUS_LABEL,
  STATUS_OPTIONS,
  STATUS_VARIANT,
  safeHostname,
} from "./status-ui";

// Sentinel value for the "Unset" item in the intent / severity selects. The
// underlying schema accepts `null` to clear; the Select component requires a
// non-empty string for each item.
const UNSET = "__unset__" as const;

interface AnnotationDetailSheetProps {
  selectedId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function AnnotationDetailSheet({ selectedId, onOpenChange }: AnnotationDetailSheetProps) {
  const isOpen = selectedId !== null;

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-xl"
        aria-describedby={undefined}
      >
        {/* Radix requires a Title for every open Dialog. Keep one rendered */}
        {/* even during the loading state; the visible heading below replaces */}
        {/* it semantically once the detail hydrates. */}
        <SheetTitle className="sr-only">Annotation detail</SheetTitle>
        {selectedId ? <DetailBody id={selectedId} onClose={() => onOpenChange(false)} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({ id, onClose }: { id: string; onClose: () => void }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const annotationQuery = trpc.annotations.get.useQuery({ id });
  const eventsQuery = trpc.annotations.listEvents.useQuery({ id });

  // G4: when the user picks "Rejected" from the status dropdown we don't fire
  // the mutation immediately — instead we open an inline reason composer.
  // `pendingRejection` is non-null while that composer is up; submitting it
  // fires the mutation, and Cancel discards it (the Select's `value` prop
  // stays bound to the persisted status, so the visual selection auto-reverts).
  const [pendingRejection, setPendingRejection] = useState<{ reason: string } | null>(null);

  const updateMutation = trpc.annotations.update.useMutation({
    onMutate: async ({ input }) => {
      // Cancel in-flight get so our optimistic value isn't overwritten.
      await utils.annotations.get.cancel({ id });
      const previous = utils.annotations.get.getData({ id });
      if (previous) {
        utils.annotations.get.setData(
          { id },
          {
            ...previous,
            ...(input.status ? { status: input.status } : {}),
            ...(input.commentText ? { commentText: input.commentText } : {}),
            // intent / severity accept null to clear; check for `undefined`
            // (no-op) rather than truthy so the optimistic patch reflects
            // null-clears immediately.
            ...(input.intent !== undefined ? { intent: input.intent } : {}),
            ...(input.severity !== undefined ? { severity: input.severity } : {}),
          }
        );
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        utils.annotations.get.setData({ id }, context.previous);
      }
    },
    onSettled: async () => {
      await Promise.all([
        utils.annotations.get.invalidate({ id }),
        utils.annotations.listEvents.invalidate({ id }),
        utils.annotations.list.invalidate(),
        utils.annotations.listForUser.invalidate(),
      ]);
      router.refresh();
    },
  });

  const deleteMutation = trpc.annotations.delete.useMutation({
    onSuccess: async () => {
      onClose();
      await Promise.all([
        utils.annotations.list.invalidate(),
        utils.annotations.listForUser.invalidate(),
      ]);
      router.refresh();
    },
  });

  if (annotationQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (annotationQuery.isError || !annotationQuery.data) {
    return (
      <div className="space-y-2 text-sm">
        <p className="font-medium text-destructive">Failed to load annotation</p>
        <p className="text-muted-foreground">{annotationQuery.error?.message ?? "Unknown error"}</p>
      </div>
    );
  }

  const annotation = annotationQuery.data;
  const screenshot = annotation.assets.find((a) => a.kind === "screenshot");
  const hostname = safeHostname(annotation.url);

  const handleDelete = () => {
    if (deleteMutation.isPending) return;
    // Native confirm is a placeholder until packages/ui ships an AlertDialog
    // primitive; gating destructive actions matters more than the chrome.
    if (!window.confirm("Delete this annotation? This can't be undone.")) return;
    deleteMutation.mutate({ id });
  };

  return (
    <div className="flex h-full flex-col gap-6">
      <header className="flex flex-col gap-2 pr-10">
        <div className="flex flex-wrap items-center gap-2 text-lg font-semibold">
          <Badge variant={STATUS_VARIANT[annotation.status]}>
            {STATUS_LABEL[annotation.status]}
          </Badge>
          {annotation.severity ? (
            <Badge variant={SEVERITY_VARIANT[annotation.severity]}>
              {SEVERITY_LABEL[annotation.severity]}
            </Badge>
          ) : null}
          {annotation.intent ? (
            <Badge variant={INTENT_VARIANT[annotation.intent]}>
              {INTENT_LABEL[annotation.intent]}
            </Badge>
          ) : null}
          <span className="text-sm font-normal text-muted-foreground">{annotation.targetType}</span>
        </div>
        <p className="truncate text-sm text-muted-foreground">
          <a
            href={annotation.url}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            {hostname ?? annotation.url}
          </a>
        </p>
      </header>

      <CommentSection
        annotation={annotation}
        onSave={(commentText) => updateMutation.mutate({ id, input: { commentText } })}
        isSaving={updateMutation.isPending}
        saveError={updateMutation.isError ? updateMutation.error.message : null}
      />

      {screenshot ? (
        <section>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Screenshot
          </h3>
          <div className="mt-2 overflow-hidden rounded-md border border-border bg-muted">
            <img src={screenshot.url} alt="" className="w-full" />
          </div>
        </section>
      ) : null}

      <MetadataPanel annotation={annotation} />

      <section>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Status
          </h3>
          {updateMutation.isPending ? (
            <span className="text-xs text-muted-foreground">saving…</span>
          ) : updateMutation.isError ? (
            <span className="text-xs text-destructive">{updateMutation.error.message}</span>
          ) : null}
        </div>
        <div className="mt-2">
          <Select
            value={annotation.status}
            onValueChange={(value) => {
              if (value === annotation.status) return;
              const next = value as AnnotationResponse["status"];
              if (next === "rejected") {
                // Defer the mutation until the user supplies a reason.
                setPendingRejection({ reason: "" });
                return;
              }
              setPendingRejection(null);
              updateMutation.mutate({ id, input: { status: next } });
            }}
            disabled={updateMutation.isPending || pendingRejection !== null}
          >
            <SelectTrigger aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {pendingRejection ? (
          <RejectionComposer
            value={pendingRejection.reason}
            onChange={(reason) => setPendingRejection({ reason })}
            onCancel={() => setPendingRejection(null)}
            onConfirm={(reason) => {
              updateMutation.mutate(
                { id, input: { status: "rejected", reason } },
                { onSuccess: () => setPendingRejection(null) }
              );
            }}
            isSaving={updateMutation.isPending}
          />
        ) : null}
      </section>

      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Intent
        </h3>
        <div className="mt-2">
          <Select
            value={annotation.intent ?? UNSET}
            onValueChange={(value) => {
              const next = value === UNSET ? null : (value as AnnotationResponse["intent"]);
              if (next === annotation.intent) return;
              updateMutation.mutate({ id, input: { intent: next } });
            }}
            disabled={updateMutation.isPending}
          >
            <SelectTrigger aria-label="Intent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>Uncategorized</SelectItem>
              {INTENT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {INTENT_LABEL[opt.value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Severity
        </h3>
        <div className="mt-2">
          <Select
            value={annotation.severity ?? UNSET}
            onValueChange={(value) => {
              const next = value === UNSET ? null : (value as AnnotationResponse["severity"]);
              if (next === annotation.severity) return;
              updateMutation.mutate({ id, input: { severity: next } });
            }}
            disabled={updateMutation.isPending}
          >
            <SelectTrigger aria-label="Severity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>Uncategorized</SelectItem>
              {SEVERITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {SEVERITY_LABEL[opt.value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Activity
        </h3>
        {eventsQuery.isPending ? (
          <p className="mt-2 text-sm text-muted-foreground">Loading activity…</p>
        ) : eventsQuery.isError ? (
          <p className="mt-2 text-sm text-destructive">
            {eventsQuery.error?.message ?? "Failed to load activity"}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {eventsQuery.data.events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4">
        <Button
          type="button"
          variant="destructive"
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
        >
          {deleteMutation.isPending ? "Deleting…" : "Delete annotation"}
        </Button>
        {deleteMutation.isError ? (
          <span className="text-xs text-destructive">{deleteMutation.error.message}</span>
        ) : null}
      </section>
    </div>
  );
}

function CommentSection({
  annotation,
  onSave,
  isSaving,
  saveError,
}: {
  annotation: AnnotationResponse;
  onSave: (commentText: string) => void;
  isSaving: boolean;
  saveError: string | null;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(annotation.commentText);

  const startEditing = () => {
    setDraft(annotation.commentText);
    setIsEditing(true);
  };

  const cancel = () => {
    setDraft(annotation.commentText);
    setIsEditing(false);
  };

  const save = () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || trimmed === annotation.commentText) {
      setIsEditing(false);
      return;
    }
    onSave(trimmed);
    setIsEditing(false);
  };

  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Comment
        </h3>
        {isEditing ? null : (
          <Button type="button" variant="ghost" size="sm" onClick={startEditing}>
            Edit
          </Button>
        )}
      </div>
      {isEditing ? (
        <div className="mt-2 space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_COMMENT_LENGTH}
            rows={5}
            aria-label="Annotation comment"
            disabled={isSaving}
          />
          <div className="flex items-center justify-end gap-2">
            {saveError ? (
              <span className="mr-auto text-xs text-destructive">{saveError}</span>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={cancel} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={save}
              disabled={isSaving || draft.trim().length === 0}
            >
              {isSaving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm">{annotation.commentText}</p>
      )}
    </section>
  );
}

function MetadataPanel({ annotation }: { annotation: AnnotationResponse }) {
  const authorLabel = annotation.author.name ?? annotation.author.email ?? "Unknown";
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
      <dt className="text-muted-foreground">Branch</dt>
      <dd>
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{annotation.branchName}</code>
      </dd>
      <dt className="text-muted-foreground">URL</dt>
      <dd className="truncate">
        <a
          href={annotation.url}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          {annotation.url}
        </a>
      </dd>
      {annotation.targetSelector ? (
        <>
          <dt className="text-muted-foreground">Selector</dt>
          <dd>
            <code className="block overflow-x-auto rounded bg-muted px-1.5 py-0.5 font-mono">
              {annotation.targetSelector}
            </code>
          </dd>
        </>
      ) : null}
      {annotation.targetCoords ? (
        <>
          <dt className="text-muted-foreground">Position</dt>
          <dd>
            {Math.round(annotation.targetCoords.x)}, {Math.round(annotation.targetCoords.y)} ·{" "}
            {Math.round(annotation.targetCoords.width)}×{Math.round(annotation.targetCoords.height)}
          </dd>
        </>
      ) : null}
      <dt className="text-muted-foreground">Viewport</dt>
      <dd>
        {annotation.viewport.width}×{annotation.viewport.height} @ {annotation.viewport.dpr}×
      </dd>
      <dt className="text-muted-foreground">Author</dt>
      <dd>{authorLabel}</dd>
      <dt className="text-muted-foreground">Created</dt>
      <dd>{new Date(annotation.createdAt).toLocaleString()}</dd>
      {annotation.updatedAt !== annotation.createdAt ? (
        <>
          <dt className="text-muted-foreground">Updated</dt>
          <dd>{new Date(annotation.updatedAt).toLocaleString()}</dd>
        </>
      ) : null}
    </dl>
  );
}

function RejectionComposer({
  value,
  onChange,
  onCancel,
  onConfirm,
  isSaving,
}: {
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: (trimmed: string) => void;
  isSaving: boolean;
}) {
  const trimmed = value.trim();
  const tooShort = trimmed.length < MIN_REJECTION_REASON_LENGTH;
  return (
    <div className="mt-3 space-y-2 rounded-md border border-border bg-muted/30 p-3">
      <label htmlFor="rejection-reason" className="block text-xs font-medium text-muted-foreground">
        Rejection reason
      </label>
      <Textarea
        id="rejection-reason"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={MAX_REJECTION_REASON_LENGTH}
        rows={3}
        placeholder={`Why is this being rejected? (≥${MIN_REJECTION_REASON_LENGTH} characters)`}
        aria-label="Rejection reason"
        disabled={isSaving}
        autoFocus
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {trimmed.length}/{MAX_REJECTION_REASON_LENGTH}
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => onConfirm(trimmed)}
            disabled={isSaving || tooShort}
          >
            {isSaving ? "Rejecting…" : "Reject"}
          </Button>
        </div>
      </div>
    </div>
  );
}
