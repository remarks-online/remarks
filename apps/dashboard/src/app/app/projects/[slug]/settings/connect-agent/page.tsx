import { env } from "@/env";
import { buildAgentPresets } from "@/lib/agent-presets";
import { getTrpcServer } from "@/lib/trpc-server";
import { auth } from "@clerk/nextjs/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@remarks/ui";
import { TRPCClientError } from "@trpc/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopySnippet } from "./_components/copy-snippet";

type Params = Promise<{ slug: string }>;

// "Connect Agent" — a guide page explaining how to install the Remarks MCP
// server in popular AI coding agents (Claude Code, Cursor, Windsurf, …).
// ADR-0015: no token is generated. The user runs an install command; the
// agent's first MCP request gets a 401, runs OAuth 2.1 + DCR + PKCE against
// Clerk, the user logs in via the browser, the agent caches its access
// token. We never see plaintext credentials.
export default async function ConnectAgentPage({ params }: { params: Params }) {
  const { slug } = await params;
  const { orgId } = await auth();

  if (!orgId) {
    return (
      <section>
        <h1 className="text-2xl font-semibold">{slug}</h1>
        <p className="mt-2 text-muted-foreground">
          Select an organization from the switcher to view this project.
        </p>
      </section>
    );
  }

  // Validate the project exists and the user has access. Mirrors the parent
  // settings page's resolution so an unknown slug returns 404 instead of
  // streaming a half-rendered page.
  const trpc = await getTrpcServer();
  let project: Awaited<ReturnType<typeof trpc.projects.getBySlug.query>>;
  try {
    project = await trpc.projects.getBySlug.query({ orgId, slug });
  } catch (err) {
    if (err instanceof TRPCClientError && err.data?.code === "NOT_FOUND") {
      notFound();
    }
    throw err;
  }

  const presets = buildAgentPresets(env.NEXT_PUBLIC_MCP_SERVER_URL);

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href={`/app/projects/${project.slug}/settings`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to {project.name} settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Connect an agent</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Hook up Claude Code, Cursor, or any MCP-compatible client to your Remarks projects. There
          are no tokens to copy — the agent will open a browser window the first time it calls a
          Remarks tool, you sign in, and you're connected.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How it works</CardTitle>
          <CardDescription>
            Remarks uses OAuth 2.1 with PKCE and Dynamic Client Registration. One sign-in covers
            every Remarks project you're a member of in this organization.
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
        {presets.map((preset) => (
          <Card key={preset.id}>
            <CardHeader>
              <CardTitle className="text-base">{preset.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {preset.installCommand ? (
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">Install (one line)</p>
                  <CopySnippet value={preset.installCommand} variant="inline" />
                </div>
              ) : null}

              <div className="space-y-1.5">
                <p className="text-sm font-medium">
                  {preset.installCommand ? "Or paste manually into" : "Paste into"}{" "}
                  <code className="rounded bg-slate-100 px-1 font-mono text-xs">
                    {preset.configFile}
                  </code>
                </p>
                <CopySnippet value={preset.configSnippet} />
              </div>

              <p className="text-sm text-muted-foreground">{preset.postInstallNote}</p>
            </CardContent>
          </Card>
        ))}
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
            <strong className="font-medium text-foreground">Wrong project showing up.</strong> The
            agent has access to every project you're a member of. Tell it which project to use by
            passing the project name or by pinning it in your prompt.
          </p>
          <p>
            <strong className="font-medium text-foreground">Disconnect an agent.</strong> Visit{" "}
            <Link href="/app/settings/account" className="underline">
              Account settings → Connected apps
            </Link>
            and revoke the grant. The agent will be locked out within 5 minutes (the membership
            cache TTL).
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
