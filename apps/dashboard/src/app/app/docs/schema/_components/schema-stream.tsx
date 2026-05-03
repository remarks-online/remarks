import { CopySnippet } from "@/components/copy-snippet";
import { SSE_EXAMPLE } from "@/lib/schema-doc-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@remarks/ui";

export function SchemaStream() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Real-time stream (SSE)</CardTitle>
        <CardDescription>
          Subscribe with an authenticated GET to receive every annotation event as it happens.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <div className="space-y-1.5">
          <h3 className="text-sm font-medium text-foreground">Endpoints</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                GET /projects/&#123;projectId&#125;/events
              </code>{" "}
              — every event for one project.
            </li>
            <li>
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                GET /users/&#123;userId&#125;/events
              </code>{" "}
              — every event the signed-in user can see (their personal annotations + any project
              they're a member of).
            </li>
          </ul>
        </div>

        <div className="space-y-1.5">
          <h3 className="text-sm font-medium text-foreground">Event envelope</h3>
          <p>
            Standard{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
              text/event-stream
            </code>
            : <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">id</code>,{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">event</code>, and
            a JSON{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">data</code> line.
            Event ids are encoded as{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
              &lt;createdAtIso&gt;:&lt;eventUuid&gt;
            </code>{" "}
            so a string compare matches the keyset order used elsewhere in the API. Reconnect with
            the standard{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
              Last-Event-ID
            </code>{" "}
            header to resume; if too many events have elapsed since your last id you'll receive a{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
              replay_truncated
            </code>{" "}
            event and should refetch state from the REST list endpoint.
          </p>
          <CopySnippet value={SSE_EXAMPLE} label="Copy" />
        </div>
      </CardContent>
    </Card>
  );
}
