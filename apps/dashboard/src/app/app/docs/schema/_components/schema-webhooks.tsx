import { CopySnippet } from "@/components/copy-snippet";
import {
  WEBHOOK_BODY_EXAMPLE,
  WEBHOOK_EVENT_DESCRIPTIONS,
  WEBHOOK_HEADERS_EXAMPLE,
} from "@/lib/schema-doc-content";
import { WEBHOOK_EVENT_TYPES } from "@remarks/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@remarks/ui";

export function SchemaWebhooks() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Outbound webhooks</CardTitle>
        <CardDescription>
          Project-scoped HTTPS callbacks for a curated subset of annotation events. Configure them
          on the project settings page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <div className="space-y-1.5">
          <h3 className="text-sm font-medium text-foreground">Event types</h3>
          <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-[max-content_1fr]">
            {WEBHOOK_EVENT_TYPES.map((type) => (
              <div key={type} className="contents">
                <dt className="font-mono text-xs leading-relaxed sm:pt-0.5">
                  <code className="rounded bg-slate-100 px-1.5 py-0.5">{type}</code>
                </dt>
                <dd className="text-sm text-muted-foreground">
                  {WEBHOOK_EVENT_DESCRIPTIONS[type]}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="space-y-1.5">
          <h3 className="text-sm font-medium text-foreground">Request body</h3>
          <p>
            Every delivery is a JSON POST. The{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">data</code> field
            carries the same payload shape that would land on the SSE event for this transition.
          </p>
          <CopySnippet value={WEBHOOK_BODY_EXAMPLE} label="Copy" />
        </div>

        <div className="space-y-1.5">
          <h3 className="text-sm font-medium text-foreground">Headers</h3>
          <CopySnippet value={WEBHOOK_HEADERS_EXAMPLE} label="Copy" />
          <p className="text-xs">
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
              Remarks-Signature
            </code>{" "}
            is Stripe-style:{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
              t=&lt;unix_seconds&gt;,v1=&lt;hex_hmac_sha256&gt;
            </code>
            . The HMAC is computed over{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
              &#96;$&#123;t&#125;.$&#123;rawBody&#125;&#96;
            </code>
            . Reject signatures whose{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">t</code> falls
            outside your replay window (we recommend ±5 minutes).
          </p>
        </div>

        <div className="space-y-1.5">
          <h3 className="text-sm font-medium text-foreground">Retries</h3>
          <p>
            Failed deliveries (any non-2xx response) are retried up to four times with exponential
            backoff. Each attempt is recorded on the project's webhooks page.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
