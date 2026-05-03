// To regenerate /public/docs/schema-lifecycle.svg after editing schema-lifecycle.mmd,
// run `pnpm --filter @remarks/dashboard docs:diagrams`.

export function SchemaLifecycleDiagram() {
  return (
    <figure className="my-1 flex justify-center">
      <img
        src="/docs/schema-lifecycle.svg"
        alt="Annotation lifecycle"
        className="h-auto w-full max-w-2xl"
      />
      <figcaption className="sr-only">
        An annotation is captured by the browser extension, stored as a record with status, intent,
        and severity, and gains an append-only event log. The event log fans out over Server-Sent
        Events and outbound webhooks to the dashboard, MCP clients, and any custom subscribers.
      </figcaption>
    </figure>
  );
}
