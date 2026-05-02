import type { AnnotationIntent, AnnotationSeverity, AnnotationStatus } from "./constants.js";
import type { AnnotationResponse } from "./schemas/annotation.js";

export type MarkdownExportScope =
  | { kind: "project"; projectName: string; branchName: string | null }
  | { kind: "personal" };

export interface MarkdownExportFilters {
  status?: AnnotationStatus | "all" | null;
  intent?: AnnotationIntent | "all" | null;
  severity?: AnnotationSeverity | "all" | null;
}

export interface MarkdownExportOptions {
  scope: MarkdownExportScope;
  /**
   * Origin of the dashboard (e.g. `https://remarks.online`). Used to build
   * per-annotation permalinks. Permalinks are omitted when this is absent —
   * useful for tests and for renders that aren't being shipped externally.
   */
  dashboardOrigin?: string;
  filters?: MarkdownExportFilters;
  /** ISO-8601 timestamp; defaults to `new Date().toISOString()`. */
  exportedAt?: string;
  /**
   * If true, the trailing screenshot row notes that the URL is presigned and
   * expires within ~24h. Default true.
   */
  noteScreenshotTtl?: boolean;
}

export function renderAnnotationsMarkdown(
  annotations: AnnotationResponse[],
  options: MarkdownExportOptions
): string {
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const scope = options.scope;

  const titleRow =
    scope.kind === "project"
      ? `# Remarks export — ${scope.projectName}`
      : "# Remarks export — Personal annotations";

  const branchRow =
    scope.kind === "project" && scope.branchName
      ? `Branch: \`${safeInlineCode(scope.branchName)}\``
      : null;

  const filterText = formatFilters(options.filters);
  const metaLine = [branchRow, filterText ? `Filters: ${filterText}` : null]
    .filter((s): s is string => Boolean(s))
    .join(" · ");

  const countLine = `Exported: ${exportedAt} · ${annotations.length} annotation${annotations.length === 1 ? "" : "s"}`;

  const header = [titleRow, metaLine || null, countLine]
    .filter((s): s is string => Boolean(s))
    .join("\n");

  if (annotations.length === 0) {
    return `${header}\n`;
  }

  const blocks = annotations.map((a, i) => renderAnnotationBlock(a, i + 1, options));
  return `${header}\n\n---\n\n${blocks.join("\n\n---\n\n")}\n`;
}

function formatFilters(f: MarkdownExportFilters | undefined): string | null {
  if (!f) return null;
  const parts: string[] = [];
  if (f.status && f.status !== "all") parts.push(`status=${f.status}`);
  if (f.intent && f.intent !== "all") parts.push(`intent=${f.intent}`);
  if (f.severity && f.severity !== "all") parts.push(`severity=${f.severity}`);
  return parts.length ? parts.join(" · ") : null;
}

function renderAnnotationBlock(
  a: AnnotationResponse,
  index: number,
  options: MarkdownExportOptions
): string {
  const tags: string[] = [`[${a.status}]`];
  if (a.intent) tags.push(`[${a.intent}]`);
  if (a.severity) tags.push(`[${a.severity}]`);

  const heading = `## ${index}. ${tags.join(" ")} ${oneLineSummary(a.commentText)}`;

  const facts: string[] = [];
  facts.push(`- **URL:** ${a.url}`);
  facts.push(`- **Target:** ${formatTarget(a)}`);
  const authorName = a.author.name ?? "(unknown)";
  const authorEmail = a.author.email ? ` (${a.author.email})` : "";
  facts.push(`- **Author:** ${authorName}${authorEmail}`);
  facts.push(`- **Created:** ${a.createdAt}`);

  const permalink = buildPermalink(a, options);
  if (permalink) facts.push(`- **Permalink:** ${permalink}`);

  const screenshot = a.assets.find((x) => x.kind === "screenshot");
  if (screenshot) {
    const ttlNote = options.noteScreenshotTtl === false ? "" : " — link expires in ~24h";
    facts.push(`- **Screenshot:** [view](${screenshot.url})${ttlNote}`);
  }

  const sections: string[] = [heading, "", facts.join("\n")];

  if (a.commentText.trim()) {
    sections.push("", formatBlockquote(a.commentText));
  }

  const reactChain = formatReactChain(a.domContext?.reactComponents ?? null);
  if (reactChain) sections.push("", reactChain);

  const ancestorChain = formatAncestorChain(a);
  if (ancestorChain) sections.push("", ancestorChain);

  return sections.join("\n");
}

function oneLineSummary(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (firstLine.length === 0) return "(no comment)";
  if (firstLine.length <= 80) return firstLine;
  return `${firstLine.slice(0, 77)}…`;
}

function formatTarget(a: AnnotationResponse): string {
  if (a.targetType === "element" && a.targetSelector) {
    return `element — \`${safeInlineCode(a.targetSelector)}\``;
  }
  if (a.targetType === "rectangle" && a.targetCoords) {
    const c = a.targetCoords;
    return `rectangle — ${Math.round(c.width)}×${Math.round(c.height)} @ (${Math.round(c.x)},${Math.round(c.y)})`;
  }
  if (a.targetType === "route") return "route";
  return a.targetType;
}

function buildPermalink(a: AnnotationResponse, options: MarkdownExportOptions): string | null {
  if (!options.dashboardOrigin) return null;
  const origin = options.dashboardOrigin.replace(/\/$/, "");
  if (options.scope.kind === "personal") {
    return `${origin}/app/personal?a=${a.id}`;
  }
  if (!a.projectSlug) return null;
  return `${origin}/app/projects/${a.projectSlug}?a=${a.id}`;
}

function formatBlockquote(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

type ReactComponentChain = NonNullable<AnnotationResponse["domContext"]>["reactComponents"];

function formatReactChain(components: ReactComponentChain): string | null {
  if (!components || components.length === 0) return null;
  const lines = components.map((c) => {
    const kindSuffix = ` (${c.kind})`;
    const sourceSuffix = c.source
      ? ` — \`${safeInlineCode(c.source.fileName)}:${c.source.lineNumber}${
          c.source.columnNumber != null ? `:${c.source.columnNumber}` : ""
        }\``
      : "";
    return `- \`<${safeInlineCode(c.name)}>\`${kindSuffix}${sourceSuffix}`;
  });
  return ["**React component chain:**", ...lines].join("\n");
}

function formatAncestorChain(a: AnnotationResponse): string | null {
  const ancestors = a.domContext?.ancestors ?? null;
  const ownTag = a.domContext?.tagName ?? null;
  const ownClasses = a.domContext?.classes ?? [];
  if ((!ancestors || ancestors.length === 0) && !ownTag) return null;
  const ownLabel = ownTag ? formatTagAndClasses(ownTag, ownClasses ?? []) : null;
  const ancestorLabels = (ancestors ?? []).map((x) =>
    formatTagAndClasses(x.tagName, x.classes ?? [])
  );
  const all = ownLabel ? [ownLabel, ...ancestorLabels] : ancestorLabels;
  if (all.length === 0) return null;
  return `**Ancestor chain:** ${all.join(" › ")}`;
}

function formatTagAndClasses(tag: string, classes: string[]): string {
  const dotted = classes.length ? `.${classes.slice(0, 3).join(".")}` : "";
  return `\`${safeInlineCode(`${tag}${dotted}`)}\``;
}

// Backticks inside inline-code spans aren't reliably escapable across markdown
// flavors. Substitute with the ASCII apostrophe so the rendered output stays
// readable instead of breaking the surrounding span.
function safeInlineCode(s: string): string {
  return s.replace(/`/g, "'");
}
