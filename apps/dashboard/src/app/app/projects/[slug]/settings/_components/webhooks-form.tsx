"use client";

import { trpc } from "@/lib/trpc-client";
import {
  WEBHOOK_EVENT_TYPES,
  type WebhookEventType,
  type WebhookResponse,
  createWebhookRequestSchema,
} from "@remarks/shared";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@remarks/ui";
import { type FormEvent, useState } from "react";

interface Props {
  projectId: string;
  canManage: boolean;
}

export function WebhooksForm({ projectId, canManage }: Props) {
  const utils = trpc.useUtils();
  const list = trpc.webhooks.list.useQuery(
    { projectId },
    {
      // Server component pre-renders the list and passes it through; for the
      // dashboard client lifecycle we still re-fetch so add/delete reflects
      // immediately. The server does not pre-fetch into the React Query
      // cache today, so this just hydrates on mount.
      enabled: canManage,
    }
  );

  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<WebhookEventType[]>(["annotation.created"]);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<{
    webhookId: string;
    secret: string;
  } | null>(null);

  const createMutation = trpc.webhooks.create.useMutation({
    onSuccess: async (created) => {
      setFormError(null);
      setUrl("");
      setSelectedEvents(["annotation.created"]);
      setCreatedSecret({ webhookId: created.id, secret: created.secret });
      await utils.webhooks.list.invalidate({ projectId });
    },
    onError: (err) => {
      setFormError(err.message);
    },
  });

  const updateMutation = trpc.webhooks.update.useMutation({
    onSuccess: async () => {
      await utils.webhooks.list.invalidate({ projectId });
    },
  });

  const deleteMutation = trpc.webhooks.delete.useMutation({
    onSuccess: async () => {
      await utils.webhooks.list.invalidate({ projectId });
    },
  });

  const rotateMutation = trpc.webhooks.rotateSecret.useMutation({
    onSuccess: async (response) => {
      setCreatedSecret({ webhookId: response.id, secret: response.secret });
      await utils.webhooks.list.invalidate({ projectId });
    },
  });

  const testMutation = trpc.webhooks.test.useMutation();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const candidate = { url: url.trim(), events: selectedEvents };
    const parsed = createWebhookRequestSchema.safeParse(candidate);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    createMutation.mutate({ projectId, input: parsed.data });
  }

  function toggleEvent(event: WebhookEventType) {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  }

  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Webhooks</CardTitle>
          <CardDescription>
            Send annotation events to external systems (Linear, Slack, your own service).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Only project admins can manage webhooks.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhooks</CardTitle>
        <CardDescription>
          POST signed JSON to a URL whenever an annotation event happens. Verify the
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">Remarks-Signature</code>
          header on the receiver side.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {createdSecret ? (
          <SecretReveal
            webhookId={createdSecret.webhookId}
            secret={createdSecret.secret}
            onDismiss={() => setCreatedSecret(null)}
          />
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          {formError ? (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="webhook-url">Endpoint URL</Label>
            <Input
              id="webhook-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/webhooks/remarks"
              required
            />
            <p className="text-xs text-muted-foreground">Must use https://.</p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Events</legend>
            <div className="space-y-1.5">
              {WEBHOOK_EVENT_TYPES.map((event) => (
                <label key={event} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(event)}
                    onChange={() => toggleEvent(event)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{event}</code>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={createMutation.isPending || selectedEvents.length === 0}
            >
              {createMutation.isPending ? "Adding…" : "Add webhook"}
            </Button>
          </div>
        </form>

        <div className="space-y-3">
          <h3 className="text-sm font-medium">Configured webhooks</h3>
          {list.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : list.data && list.data.length > 0 ? (
            <ul className="space-y-3">
              {list.data.map((webhook) => (
                <WebhookRow
                  key={webhook.id}
                  webhook={webhook}
                  onToggleActive={(next) =>
                    updateMutation.mutate({
                      webhookId: webhook.id,
                      input: { active: next },
                    })
                  }
                  onDelete={() => deleteMutation.mutate({ webhookId: webhook.id })}
                  onRotate={() => rotateMutation.mutate({ webhookId: webhook.id })}
                  onTest={() =>
                    testMutation.mutate({
                      webhookId: webhook.id,
                      eventType: "annotation.created",
                    })
                  }
                  testFeedback={
                    testMutation.variables?.webhookId === webhook.id
                      ? testMutation.isPending
                        ? "Sending…"
                        : testMutation.isSuccess
                          ? "Test event queued."
                          : testMutation.error
                            ? testMutation.error.message
                            : null
                      : null
                  }
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No webhooks configured yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SecretReveal({
  webhookId,
  secret,
  onDismiss,
}: {
  webhookId: string;
  secret: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
      <p className="text-sm font-medium">Save this signing secret now.</p>
      <p className="text-xs text-muted-foreground">
        It won't be shown again. Use it to verify the
        <code className="mx-1 rounded bg-muted px-1 py-0.5">Remarks-Signature</code>
        header on each delivery.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 break-all rounded bg-background px-2 py-1.5 font-mono text-xs">
          {secret}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(secret);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? "Copied!" : "Copy"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Webhook ID: {webhookId}</p>
    </div>
  );
}

function WebhookRow({
  webhook,
  onToggleActive,
  onDelete,
  onRotate,
  onTest,
  testFeedback,
}: {
  webhook: WebhookResponse;
  onToggleActive: (next: boolean) => void;
  onDelete: () => void;
  onRotate: () => void;
  onTest: () => void;
  testFeedback: string | null;
}) {
  return (
    <li className="space-y-2 rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="break-all font-mono text-sm">{webhook.url}</p>
          <div className="flex flex-wrap gap-1">
            {webhook.events.map((event) => (
              <Badge key={event} variant="outline" className="font-mono text-[10px]">
                {event}
              </Badge>
            ))}
          </div>
        </div>
        <Badge variant={webhook.active ? "default" : "outline"}>
          {webhook.active ? "Active" : "Paused"}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onToggleActive(!webhook.active)}
        >
          {webhook.active ? "Pause" : "Resume"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onTest}>
          Send test
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            if (
              confirm(
                "Rotate the signing secret? Existing receivers will reject deliveries until updated."
              )
            ) {
              onRotate();
            }
          }}
        >
          Rotate secret
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => {
            if (confirm("Delete this webhook? This can't be undone.")) onDelete();
          }}
        >
          Delete
        </Button>
      </div>
      {testFeedback ? <p className="text-xs text-muted-foreground">{testFeedback}</p> : null}
    </li>
  );
}
