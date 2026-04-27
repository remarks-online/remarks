import { CopySnippet } from "@/components/copy-snippet";
import type { AgentPreset } from "@/lib/agent-presets";
import { Card, CardContent, CardHeader, CardTitle } from "@remarks/ui";

export function AgentPresetDetails({ preset }: { preset: AgentPreset }) {
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
