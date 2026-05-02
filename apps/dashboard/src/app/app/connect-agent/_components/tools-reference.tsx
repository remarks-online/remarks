import { EXAMPLE_PROMPTS, type ExamplePromptPhase, TOOL_BLURBS } from "@/lib/tool-examples";
import { REMARKS_TOOLS } from "@remarks/mcp-schema";
import { Card, CardContent, CardHeader, CardTitle } from "@remarks/ui";

const PHASE_ORDER: readonly ExamplePromptPhase[] = [
  "Getting oriented",
  "Finding work",
  "Picking up a task",
  "Doing the work",
  "Wrapping up",
];

export function ToolsReference() {
  const promptsByPhase = new Map<ExamplePromptPhase, typeof EXAMPLE_PROMPTS>();
  for (const phase of PHASE_ORDER) {
    promptsByPhase.set(
      phase,
      EXAMPLE_PROMPTS.filter((p) => p.phase === phase)
    );
  }

  return (
    <div className="space-y-6">
      {PHASE_ORDER.map((phase) => {
        const prompts = promptsByPhase.get(phase);
        if (!prompts || prompts.length === 0) return null;
        return (
          <div key={phase} className="space-y-3">
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {phase}
            </h3>
            <div className="space-y-3">
              {prompts.map((p) => (
                <Card key={p.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium leading-snug">
                      &ldquo;{p.prompt}&rdquo;
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 pt-0">
                    <p className="text-sm text-muted-foreground">{p.outcome}</p>
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-xs text-muted-foreground">Tools used:</span>
                      {p.tools.map((toolName) => (
                        <code
                          key={toolName}
                          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs"
                        >
                          {toolName}
                        </code>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All available tools</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-[max-content_1fr]">
            {REMARKS_TOOLS.map((tool) => (
              <div key={tool.name} className="contents">
                <dt className="font-mono text-xs leading-relaxed sm:pt-0.5">
                  <code className="rounded bg-slate-100 px-1.5 py-0.5">{tool.name}</code>
                </dt>
                <dd className="text-sm text-muted-foreground">{TOOL_BLURBS[tool.name]}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
