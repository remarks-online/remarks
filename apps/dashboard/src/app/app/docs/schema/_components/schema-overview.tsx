import { SCHEMA_DOC_LINKS } from "@/lib/schema-doc-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@remarks/ui";

export function SchemaOverview() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Overview</CardTitle>
        <CardDescription>What every Remarks integration sees on the wire.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>
          The Remarks Annotation Schema is the wire format every annotation flows through — the
          extension that captures it, the dashboard that renders it, MCP clients reading or writing
          it, the SSE stream that broadcasts changes, and outbound webhooks delivering them to your
          tools. One shape, one source of truth.
        </p>
        <p>
          The canonical Zod schema lives in{" "}
          <a
            href={SCHEMA_DOC_LINKS.zodSource}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
              packages/shared/src/schemas/annotation.ts
            </code>
          </a>
          ; the architectural rationale for v1 is in{" "}
          <a href={SCHEMA_DOC_LINKS.adr0016} target="_blank" rel="noreferrer" className="underline">
            ADR-0016
          </a>
          . The schema is versioned (v1) and additive: new fields land as nullable, and new event
          types are append-only.
        </p>
      </CardContent>
    </Card>
  );
}
