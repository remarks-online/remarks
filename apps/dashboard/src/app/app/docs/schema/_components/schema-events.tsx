import { ANNOTATION_EVENT_GROUPS, EVENT_ACTOR_NOTE } from "@/lib/schema-doc-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@remarks/ui";

export function SchemaEvents() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Annotation events</CardTitle>
        <CardDescription>
          Every state-changing operation appends to an annotation's event log. The same set of types
          is replayed on the SSE stream and (a curated subset) is delivered to outbound webhooks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {ANNOTATION_EVENT_GROUPS.map((group) => (
          <section key={group.title} className="space-y-2">
            <div className="space-y-0.5">
              <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                {group.title}
              </h3>
              <p className="text-sm text-muted-foreground">{group.description}</p>
            </div>
            <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-[max-content_1fr]">
              {group.events.map((event) => (
                <div key={event.type} className="contents">
                  <dt className="font-mono text-xs leading-relaxed sm:pt-0.5">
                    <code className="rounded bg-slate-100 px-1.5 py-0.5">{event.type}</code>
                  </dt>
                  <dd className="space-y-1 text-sm text-muted-foreground">
                    <p>{event.description}</p>
                    <p className="text-xs">
                      <span className="text-muted-foreground/80">Payload: </span>
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                        {event.payload}
                      </code>
                    </p>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        <section className="space-y-2 rounded-md border border-dashed bg-slate-50/50 p-3">
          <h3 className="text-sm font-medium">Actor context</h3>
          <p className="text-sm text-muted-foreground">{EVENT_ACTOR_NOTE}</p>
        </section>
      </CardContent>
    </Card>
  );
}
