import { SCHEMA_DOC_LINKS } from "@/lib/schema-doc-content";
import { SchemaAnnotationObject } from "./_components/schema-annotation-object";
import { SchemaDomContext } from "./_components/schema-dom-context";
import { SchemaEnums } from "./_components/schema-enums";
import { SchemaEvents } from "./_components/schema-events";
import { SchemaOverview } from "./_components/schema-overview";
import { SchemaStream } from "./_components/schema-stream";
import { SchemaWebhooks } from "./_components/schema-webhooks";

export default function SchemaReferencePage() {
  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Annotation schema reference</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          An annotation is a comment your team or an agent attaches to a specific spot on a web page
          — an element, a region, or a whole route. This page describes the annotation object you'll
          read and write through Remarks: its shape, the events it emits as it moves through triage,
          and the two channels — Server-Sent Events and outbound webhooks — that deliver those
          events to your tools.
        </p>
      </div>

      <SchemaOverview />
      <SchemaAnnotationObject />
      <SchemaEnums />
      <SchemaDomContext />
      <SchemaEvents />
      <SchemaStream />
      <SchemaWebhooks />

      <p className="px-1 text-xs text-muted-foreground">
        The canonical schema definitions live in{" "}
        <a href={SCHEMA_DOC_LINKS.zodSource} target="_blank" rel="noreferrer" className="underline">
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">
            packages/shared/src/schemas/annotation.ts
          </code>
        </a>
        .
      </p>
    </section>
  );
}
