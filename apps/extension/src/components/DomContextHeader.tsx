import type { ReactComponentKind } from "@remarks/shared";
import { Collapsible, CollapsibleContent, CollapsibleTrigger, cn } from "@remarks/ui";
import { ChevronDown } from "lucide-react";

// Accept either the create-time shape (fields optional/undefined) from the
// picker store or the response-time shape (fields nullable) from the API.
// Each field may be present-with-value, present-with-null, or absent.
//
// `reactComponents` carries an extra wrinkle: the input shape has
// `source?: {... columnNumber?: number}` while the response shape has
// `source: {... columnNumber: number | null} | null`. Widen the field here so
// either shape parses without a runtime translation step.
interface ReactComponentNodeLike {
  name: string;
  kind: ReactComponentKind;
  source?:
    | {
        fileName: string;
        lineNumber: number;
        columnNumber?: number | null | undefined;
      }
    | null
    | undefined;
}

interface DomContextLike {
  tagName?: string | null | undefined;
  classes?: string[] | null | undefined;
  computedStyles?: Record<string, string> | null | undefined;
  ancestors?: Array<{ tagName: string; classes?: string[] | null | undefined }> | null | undefined;
  reactComponents?: ReactComponentNodeLike[] | null | undefined;
}

interface Props {
  selector: string;
  domContext: DomContextLike | null | undefined;
}

function formatCrumb(
  tag: string | null | undefined,
  classes: readonly string[] | null | undefined
): string {
  if (!tag) return "";
  const firstClass = classes?.[0];
  return firstClass ? `${tag}.${firstClass}` : tag;
}

function elementIdentifier(
  domContext: DomContextLike | null | undefined,
  fallback: string
): string {
  const tag = domContext?.tagName ?? "element";
  const classes = domContext?.classes ?? [];
  if (classes.length === 0) return fallback;
  return `${tag}.${classes.slice(0, 2).join(".")}`;
}

function breadcrumbCrumbs(domContext: DomContextLike | null | undefined): string[] {
  if (!domContext) return [];
  const ancestors = (domContext.ancestors ?? []).slice().reverse();
  const crumbs = ancestors.map((a) => formatCrumb(a.tagName, a.classes)).filter(Boolean);
  const self = formatCrumb(domContext.tagName, domContext.classes);
  if (self) crumbs.push(self);
  return crumbs;
}

function reactComponentTooltip(c: ReactComponentNodeLike): string {
  const parts: string[] = [c.kind];
  if (c.source) {
    const file = c.source.fileName.split("/").slice(-2).join("/");
    parts.push(`${file}:${c.source.lineNumber}`);
  }
  return parts.join(" · ");
}

export function DomContextHeader({ selector, domContext }: Props) {
  const identifier = elementIdentifier(domContext, selector);
  const crumbs = breadcrumbCrumbs(domContext);
  const computed = domContext?.computedStyles;
  const hasComputed = computed && Object.keys(computed).length > 0;
  const reactComponents = domContext?.reactComponents ?? [];
  const hasReact = reactComponents.length > 0;

  return (
    <Collapsible className="flex flex-col gap-1.5">
      <CollapsibleTrigger
        className={cn(
          "group flex w-full items-center justify-between gap-2 rounded-sm text-left",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          !hasComputed && "cursor-default"
        )}
        disabled={!hasComputed}
      >
        <span className="truncate font-mono text-xs font-medium text-foreground">{identifier}</span>
        {hasComputed ? (
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
            aria-hidden
          />
        ) : null}
      </CollapsibleTrigger>
      {crumbs.length > 0 ? (
        <p className="break-words font-mono text-[11px] leading-snug text-muted-foreground">
          {crumbs.join(" › ")}
        </p>
      ) : null}
      {hasReact ? (
        <p className="break-words font-mono text-[11px] leading-snug text-foreground/80">
          {reactComponents.map((c, i) => (
            <span key={`${c.name}-${i}`} title={reactComponentTooltip(c)}>
              {i > 0 ? <span className="text-muted-foreground"> ‹ </span> : null}
              {c.name}
            </span>
          ))}
        </p>
      ) : null}
      {hasComputed ? (
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-none">
          <dl className="mt-1 grid max-h-48 grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 overflow-y-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-snug">
            {Object.entries(computed).map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">{key}</dt>
                <dd className="truncate text-foreground" title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}
