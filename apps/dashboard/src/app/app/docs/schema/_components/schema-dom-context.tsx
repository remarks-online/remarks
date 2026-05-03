import {
  DOM_CONTEXT_FIELDS,
  REACT_COMPONENT_KIND_DESCRIPTIONS,
  SCHEMA_DOC_LINKS,
} from "@/lib/schema-doc-content";
import { REACT_COMPONENT_KINDS } from "@remarks/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@remarks/ui";

export function SchemaDomContext() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">DOM context</CardTitle>
        <CardDescription>
          Captured for element annotations only. Null for rectangle / route, or for rows that
          predate DOM capture.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="space-y-2">
          <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Fields
          </h3>
          <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-[max-content_max-content_1fr]">
            {DOM_CONTEXT_FIELDS.map((field) => (
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
        </section>

        <section className="space-y-2">
          <div className="space-y-0.5">
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              ReactComponentNode
            </h3>
            <p className="text-sm text-muted-foreground">
              One node per fiber in the leaf-to-root chain. Captured by a MAIN-world bridge that
              walks the picked element's React fiber. Each node is{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                {"{ name, kind, source? }"}
              </code>
              ; <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">source</code>{" "}
              is dev-only and best-effort (production-minified bundles strip it). See{" "}
              <a
                href={SCHEMA_DOC_LINKS.adr0019ReactTree}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                ADR-0019 (React component tree)
              </a>{" "}
              for the full design.
            </p>
          </div>
          <ul className="space-y-1.5">
            {REACT_COMPONENT_KINDS.map((kind) => (
              <li
                key={kind}
                className="grid gap-x-3 sm:grid-cols-[max-content_1fr] sm:items-baseline"
              >
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">{kind}</code>
                <p className="text-sm text-muted-foreground">
                  {REACT_COMPONENT_KIND_DESCRIPTIONS[kind]}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}
