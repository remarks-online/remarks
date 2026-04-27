"use client";

import { CopySnippet } from "@/components/copy-snippet";
import { type AgentPreset, buildAgentPresets } from "@/lib/agent-presets";
import { capture } from "@/lib/analytics";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@remarks/ui";
import { useState } from "react";

// Read NEXT_PUBLIC_* directly — see analytics.ts for why we don't import the
// server `env` schema from a "use client" module.
const MCP_SERVER_URL = process.env.NEXT_PUBLIC_MCP_SERVER_URL ?? "https://mcp.remarks.online/mcp";

interface Props {
  onAdvance: (selectedAgentId: string) => void;
  onSkip: () => void;
}

// Optional step in the personal-first onboarding flow: connect an AI coding
// agent (Claude Code, Cursor, Windsurf, …) to the Remarks MCP server. There's
// nothing to verify server-side — auth happens lazily on first tool call via
// OAuth 2.1 + DCR + PKCE — so the step advances on the user's "I've installed"
// click rather than auto-detecting like the extension step does.
export function StepInstallMcp({ onAdvance, onSkip }: Props) {
  const presets = buildAgentPresets(MCP_SERVER_URL);
  const [selectedId, setSelectedId] = useState<string>(presets[0]?.id ?? "claude-code");
  const selected = presets.find((p) => p.id === selectedId) ?? presets[0];

  function confirm() {
    capture("onboarding_step_completed", { step: 3, agent: selectedId });
    onAdvance(selectedId);
  }

  return (
    <div className="space-y-6 rounded-md border border-border p-6">
      <div>
        <h2 className="text-lg font-semibold">Connect an AI coding agent</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Hook up Claude Code, Cursor, or any MCP-compatible client to your Remarks tasks. There are
          no tokens to copy — the agent opens a browser window the first time it calls a Remarks
          tool, you sign in, and you're connected.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <Button
            key={preset.id}
            type="button"
            variant={preset.id === selectedId ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedId(preset.id)}
          >
            {preset.name}
          </Button>
        ))}
      </div>

      {selected ? <PresetDetails preset={selected} /> : null}

      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={onSkip}>
          Skip — I'll set this up later
        </Button>
        <Button onClick={confirm}>I've installed it</Button>
      </div>
    </div>
  );
}

function PresetDetails({ preset }: { preset: AgentPreset }) {
  return (
    <Card>
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
            <code className="rounded bg-slate-100 px-1 font-mono text-xs">{preset.configFile}</code>
          </p>
          <CopySnippet value={preset.configSnippet} />
        </div>

        <p className="text-sm text-muted-foreground">{preset.postInstallNote}</p>
      </CardContent>
    </Card>
  );
}
