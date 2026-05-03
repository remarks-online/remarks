import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@remarks/ui";
import { SchemaLifecycleDiagram } from "./schema-lifecycle-diagram";

export function SchemaOverview() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Overview</CardTitle>
        <CardDescription>How an annotation gets from a browser to your tools.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>
          Someone — a teammate, a stakeholder, an agent — clicks a button in the Remarks extension
          and pins a comment to a page. The pin is captured as an annotation: a JSON object with a
          stable id, an author, a target on the page, and a triage state.
        </p>
        <SchemaLifecycleDiagram />
        <p>
          From there, every change to the annotation — a status flip, a new comment, an agent
          picking it up — appends to its event log. The same events fan out to a real-time SSE
          stream and to outbound webhooks, so the dashboard, your bug tracker, and your AI coding
          tools all see the same picture at the same time.
        </p>
      </CardContent>
    </Card>
  );
}
