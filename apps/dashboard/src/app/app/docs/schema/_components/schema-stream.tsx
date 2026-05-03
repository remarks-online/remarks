import { CopySnippet } from "@/components/copy-snippet";
import {
  SCHEMA_DOC_LINKS,
  SSE_EXAMPLE,
  SSE_REPLAY_TRUNCATED_EXAMPLE,
} from "@/lib/schema-doc-content";
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
              — every event for one project (Clerk-auth).
            </li>
            <li>
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                GET /users/&#123;userId&#125;/events
              </code>{" "}
              — every event the signed-in user can see (their personal annotations + any project
              they're a member of).
            </li>
            <li>
              MCP-auth variants live under{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                /internal/projects/&#123;projectId&#125;/events
              </code>{" "}
              and{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                /internal/users/&#123;clerkUserId&#125;/events
              </code>
              .
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
            so a string compare matches the keyset order used elsewhere in the API.
          </p>
          <CopySnippet value={SSE_EXAMPLE} label="Copy" />
        </div>

        <div className="space-y-1.5">
          <h3 className="text-sm font-medium text-foreground">Resume + truncation</h3>
          <p>
            Reconnect with the standard{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
              Last-Event-ID
            </code>{" "}
            header. The server replays missed events from an in-process ring buffer (up to 256
            recent events) and falls back to a DB-backed read capped at 200 rows. If the cap is hit,
            the client receives a{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
              replay_truncated
            </code>{" "}
            event and should refresh state via the REST list endpoint.
          </p>
          <CopySnippet value={SSE_REPLAY_TRUNCATED_EXAMPLE} label="Copy" />
        </div>

        <div className="space-y-1.5">
          <h3 className="text-sm font-medium text-foreground">Connection limits</h3>
          <p>
            The server caps in-flight SSE connections (default 200) and rotates each connection
            after a fixed lifetime (default 5 minutes) by emitting{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
              event: rotate
            </code>{" "}
            and closing. Browsers' built-in EventSource reconnects automatically with{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
              Last-Event-ID
            </code>
            ; non-browser clients should do the same.
          </p>
        </div>

        <p className="text-xs">
          See also:{" "}
          <a
            href={SCHEMA_DOC_LINKS.adr0019Sse}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            ADR-0019 (SSE event stream)
          </a>
          .
        </p>
      </CardContent>
    </Card>
  );
}
