import { env } from "@/env";
import { buildAgentPresets } from "@/lib/agent-presets";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@remarks/ui";
import Link from "next/link";
import { AgentPicker } from "./_components/agent-picker";

// User-level "Connect Agent" install guide. Grants are per-user (ADR-0015) and
// one OAuth login covers every Remarks project the user is a member of, so the
// instructions don't depend on a specific project. Linked from the dashboard
// header and from per-project settings.
export default function ConnectAgentPage() {
  const presets = buildAgentPresets(env.NEXT_PUBLIC_MCP_SERVER_URL);

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Connect an agent</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Hook up Claude Code, Cursor, or any MCP-compatible client to your Remarks tasks. There are
          no tokens to copy — the agent will open a browser window the first time it calls a Remarks
          tool, you sign in, and you're connected.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How it works</CardTitle>
          <CardDescription>
            Remarks uses OAuth 2.1 with PKCE and Dynamic Client Registration. One sign-in covers
            every Remarks task you can see — your personal annotations and any team projects you're
            a member of.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ol className="ml-5 list-decimal space-y-1.5">
            <li>
              Run the install command for your agent below — or paste the JSON snippet into your
              agent's MCP config file.
            </li>
            <li>
              Restart the agent if it doesn't pick up the config automatically. Then call any
              Remarks tool — <code className="rounded bg-slate-100 px-1">remarks_whoami</code> is a
              good first one.
            </li>
            <li>
              A browser window opens at the Remarks login. Sign in (if you aren't already), approve
              the requested scopes (<code className="rounded bg-slate-100 px-1">tasks:read</code>,{" "}
              <code className="rounded bg-slate-100 px-1">tasks:write</code>,{" "}
              <code className="rounded bg-slate-100 px-1">project:read</code>), and return to your
              agent.
            </li>
            <li>
              Verify the connection in{" "}
              <Link href="/app/settings/account" className="underline">
                Account settings → Connected apps
              </Link>{" "}
              — your agent should appear with its name and last-used timestamp.
            </li>
          </ol>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Pick your agent</h2>
        <AgentPicker presets={presets} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Troubleshooting</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong className="font-medium text-foreground">Agent never opens a browser.</strong>{" "}
            The MCP authorization step is triggered by the first tool call, not by the install. Send
            a message that requires Remarks (e.g. "list my Remarks tasks") to kick it off.
          </p>
          <p>
            <strong className="font-medium text-foreground">"Invalid token" errors.</strong> Your
            access token may have expired (lifetime: 2h). Most agents refresh automatically; if not,
            restart the agent and try again.
          </p>
          <p>
            <strong className="font-medium text-foreground">Wrong scope showing up.</strong> The
            agent has access to every project you're a member of, plus your personal annotations.
            Tell it which scope to use by passing the project name or by pinning it in your prompt.
          </p>
          <p>
            <strong className="font-medium text-foreground">Disconnect an agent.</strong> Visit{" "}
            <Link href="/app/settings/account" className="underline">
              Account settings → Connected apps
            </Link>{" "}
            and revoke the grant. The agent will be locked out within 5 minutes (the membership
            cache TTL).
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
