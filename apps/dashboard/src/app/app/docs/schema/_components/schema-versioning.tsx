import { SCHEMA_ADRS } from "@/lib/schema-doc-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@remarks/ui";

export function SchemaVersioning() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Versioning</CardTitle>
        <CardDescription>
          The schema is v1. Changes are additive: new fields land as nullable, new event types are
          append-only, and existing values never change meaning.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>
          Architectural decisions touching the schema are recorded as ADRs in the repo. They are the
          source of truth for why a field exists and what changed when.
        </p>
        <ul className="space-y-1.5">
          {SCHEMA_ADRS.map((adr) => (
            <li key={adr.href} className="flex flex-wrap items-baseline gap-x-2">
              <a href={adr.href} target="_blank" rel="noreferrer" className="underline">
                ADR-{adr.number}
              </a>
              <span>— {adr.title}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
