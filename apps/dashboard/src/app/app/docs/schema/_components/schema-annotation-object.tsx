import { ANNOTATION_FIELD_GROUPS, type FieldRow } from "@/lib/schema-doc-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@remarks/ui";

export function SchemaAnnotationObject() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Annotation object</CardTitle>
        <CardDescription>
          The shape every read returns — REST list, MCP <code>get_task</code>, SSE replay, and
          dashboard detail sheet all share these fields.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {ANNOTATION_FIELD_GROUPS.map((group) => (
          <section key={group.title} className="space-y-2">
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {group.title}
            </h3>
            {group.description ? (
              <p className="text-sm text-muted-foreground">{group.description}</p>
            ) : null}
            <FieldList fields={group.fields} />
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

function FieldList({ fields }: { fields: FieldRow[] }) {
  return (
    <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-[max-content_max-content_1fr]">
      {fields.map((field) => (
        <div key={field.name} className="contents">
          <dt className="font-mono text-xs leading-relaxed sm:pt-0.5">
            <code className="rounded bg-slate-100 px-1.5 py-0.5">{field.name}</code>
          </dt>
          <dd className="text-xs leading-relaxed text-muted-foreground sm:pt-0.5">
            <span className="font-mono">{field.type}</span>
            {field.nullable ? <span className="ml-1 italic">(nullable)</span> : null}
          </dd>
          <dd className="text-sm text-muted-foreground">{field.description}</dd>
        </div>
      ))}
    </dl>
  );
}
