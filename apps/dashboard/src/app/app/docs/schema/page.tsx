import { SchemaAnnotationObject } from "./_components/schema-annotation-object";
import { SchemaDomContext } from "./_components/schema-dom-context";
import { SchemaEnums } from "./_components/schema-enums";
import { SchemaEvents } from "./_components/schema-events";
import { SchemaOverview } from "./_components/schema-overview";
import { SchemaStream } from "./_components/schema-stream";
import { SchemaVersioning } from "./_components/schema-versioning";
import { SchemaWebhooks } from "./_components/schema-webhooks";

export default function SchemaReferencePage() {
  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Annotation schema reference</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The wire format every Remarks integration sees. Use this page to understand what the
          extension captures, what the dashboard renders, what MCP returns, and what lands on the
          SSE stream and outbound webhooks.
        </p>
      </div>

      <SchemaOverview />
      <SchemaAnnotationObject />
      <SchemaEnums />
      <SchemaDomContext />
      <SchemaEvents />
      <SchemaStream />
      <SchemaWebhooks />
      <SchemaVersioning />
    </section>
  );
}
