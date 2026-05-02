import { describe, expect, test } from "vitest";
import { renderAnnotationsMarkdown } from "./markdown-export.js";
import type { AnnotationResponse } from "./schemas/annotation.js";

const FIXED_NOW = "2026-05-02T18:30:00.000Z";

function makeAnnotation(overrides: Partial<AnnotationResponse> = {}): AnnotationResponse {
  const base: AnnotationResponse = {
    id: "11111111-1111-1111-1111-111111111111",
    projectId: "22222222-2222-2222-2222-222222222222",
    projectSlug: "demo-project",
    branchId: "33333333-3333-3333-3333-333333333333",
    branchName: "main",
    status: "to_do",
    targetType: "element",
    intent: "fix",
    severity: "blocking",
    url: "https://example.com/page",
    targetSelector: "button.btn-primary",
    targetCoords: null,
    viewport: { width: 1440, height: 900, dpr: 2 },
    domContext: {
      tagName: "button",
      classes: ["btn-primary"],
      textContent: "Submit",
      computedStyles: null,
      ancestors: [
        { tagName: "form", classes: ["signup-form"] },
        { tagName: "div", classes: ["container"] },
      ],
      reactComponents: [
        {
          name: "SubmitButton",
          kind: "forward_ref",
          source: { fileName: "apps/foo/src/Button.tsx", lineNumber: 42, columnNumber: 5 },
        },
        { name: "SignupForm", kind: "function", source: null },
      ],
    },
    frameworkHint: "react",
    commentText: "The submit button color is wrong on hover.",
    author: {
      id: "44444444-4444-4444-4444-444444444444",
      name: "Jane Doe",
      email: "jane@example.com",
      avatarUrl: null,
    },
    assets: [
      {
        id: "55555555-5555-5555-5555-555555555555",
        kind: "screenshot",
        url: "https://r2.example.com/abc?sig=xyz",
        contentType: "image/png",
      },
    ],
    createdAt: "2026-05-02T10:30:00.000Z",
    updatedAt: "2026-05-02T10:30:00.000Z",
  };
  return { ...base, ...overrides };
}

describe("renderAnnotationsMarkdown", () => {
  test("renders a fully-populated project annotation with all sections", () => {
    const md = renderAnnotationsMarkdown([makeAnnotation()], {
      scope: { kind: "project", projectName: "Demo", branchName: "main" },
      dashboardOrigin: "https://remarks.online",
      filters: { status: "to_do", intent: "fix", severity: "blocking" },
      exportedAt: FIXED_NOW,
    });
    expect(md).toContain("# Remarks export — Demo");
    expect(md).toContain("Branch: `main`");
    expect(md).toContain("Filters: status=to_do · intent=fix · severity=blocking");
    expect(md).toContain(`Exported: ${FIXED_NOW} · 1 annotation`);
    expect(md).toContain(
      "## 1. [to_do] [fix] [blocking] The submit button color is wrong on hover."
    );
    expect(md).toContain("- **URL:** https://example.com/page");
    expect(md).toContain("- **Target:** element — `button.btn-primary`");
    expect(md).toContain("- **Author:** Jane Doe (jane@example.com)");
    expect(md).toContain("- **Created:** 2026-05-02T10:30:00.000Z");
    expect(md).toContain(
      "- **Permalink:** https://remarks.online/app/projects/demo-project?a=11111111-1111-1111-1111-111111111111"
    );
    expect(md).toContain(
      "- **Screenshot:** [view](https://r2.example.com/abc?sig=xyz) — link expires in ~24h"
    );
    expect(md).toContain("> The submit button color is wrong on hover.");
    expect(md).toContain("**React component chain:**");
    expect(md).toContain("- `<SubmitButton>` (forward_ref) — `apps/foo/src/Button.tsx:42:5`");
    expect(md).toContain("- `<SignupForm>` (function)");
    expect(md).toContain(
      "**Ancestor chain:** `button.btn-primary` › `form.signup-form` › `div.container`"
    );
  });

  test("collapses tags when intent and severity are null", () => {
    const md = renderAnnotationsMarkdown([makeAnnotation({ intent: null, severity: null })], {
      scope: { kind: "project", projectName: "Demo", branchName: "main" },
      exportedAt: FIXED_NOW,
    });
    expect(md).toContain("## 1. [to_do] The submit button");
    expect(md).not.toContain("[fix]");
    expect(md).not.toContain("[blocking]");
  });

  test("renders rectangle target with rounded coordinates", () => {
    const md = renderAnnotationsMarkdown(
      [
        makeAnnotation({
          targetType: "rectangle",
          targetSelector: null,
          targetCoords: { x: 40.4, y: 120.8, width: 200.2, height: 80.7 },
        }),
      ],
      {
        scope: { kind: "project", projectName: "Demo", branchName: "main" },
        exportedAt: FIXED_NOW,
      }
    );
    expect(md).toContain("- **Target:** rectangle — 200×81 @ (40,121)");
  });

  test("renders route target with no selector or coords", () => {
    const md = renderAnnotationsMarkdown(
      [
        makeAnnotation({
          targetType: "route",
          targetSelector: null,
          targetCoords: null,
          domContext: null,
        }),
      ],
      {
        scope: { kind: "project", projectName: "Demo", branchName: "main" },
        exportedAt: FIXED_NOW,
      }
    );
    expect(md).toContain("- **Target:** route");
    expect(md).not.toContain("**Ancestor chain:**");
    expect(md).not.toContain("**React component chain:**");
  });

  test("personal scope skips permalinks when projectSlug is null", () => {
    const md = renderAnnotationsMarkdown(
      [makeAnnotation({ projectId: null, projectSlug: null, branchId: null, branchName: null })],
      {
        scope: { kind: "personal" },
        dashboardOrigin: "https://remarks.online",
        exportedAt: FIXED_NOW,
      }
    );
    expect(md).toContain("# Remarks export — Personal annotations");
    expect(md).toContain(
      "- **Permalink:** https://remarks.online/app/personal?a=11111111-1111-1111-1111-111111111111"
    );
    expect(md).not.toContain("Branch: ");
  });

  test("omits permalink when dashboardOrigin is missing", () => {
    const md = renderAnnotationsMarkdown([makeAnnotation()], {
      scope: { kind: "project", projectName: "Demo", branchName: "main" },
      exportedAt: FIXED_NOW,
    });
    expect(md).not.toContain("**Permalink:**");
  });

  test("renders empty list as header only", () => {
    const md = renderAnnotationsMarkdown([], {
      scope: { kind: "project", projectName: "Demo", branchName: "main" },
      exportedAt: FIXED_NOW,
    });
    expect(md).toContain("# Remarks export — Demo");
    expect(md).toContain(`Exported: ${FIXED_NOW} · 0 annotations`);
    expect(md).not.toContain("---");
    expect(md).not.toContain("## 1.");
  });

  test("multi-line comments wrap as a blockquote, each line prefixed", () => {
    const md = renderAnnotationsMarkdown(
      [makeAnnotation({ commentText: "first line\nsecond line\nthird" })],
      {
        scope: { kind: "project", projectName: "Demo", branchName: "main" },
        exportedAt: FIXED_NOW,
      }
    );
    expect(md).toContain("> first line\n> second line\n> third");
    // Heading uses only the first line, trimmed.
    expect(md).toContain("## 1. [to_do] [fix] [blocking] first line");
  });

  test("sanitizes backticks in inline-code spans", () => {
    const md = renderAnnotationsMarkdown(
      [
        makeAnnotation({
          targetSelector: "div.has`tick`",
          domContext: {
            tagName: "div",
            classes: ["has`tick`"],
            textContent: null,
            computedStyles: null,
            ancestors: null,
            reactComponents: [
              {
                name: "Weird`Name",
                kind: "function",
                source: { fileName: "src/`weird`.tsx", lineNumber: 1, columnNumber: null },
              },
            ],
          },
        }),
      ],
      {
        scope: { kind: "project", projectName: "Demo", branchName: "main" },
        exportedAt: FIXED_NOW,
      }
    );
    // Backticks inside inline-code spans are replaced with apostrophes.
    expect(md).toContain("- **Target:** element — `div.has'tick'`");
    expect(md).toContain("- `<Weird'Name>` (function) — `src/'weird'.tsx:1`");
    expect(md).toContain("`div.has'tick'`");
  });

  test("truncates long first lines to 80 chars with ellipsis", () => {
    const longComment = `${"x".repeat(120)}`;
    const md = renderAnnotationsMarkdown([makeAnnotation({ commentText: longComment })], {
      scope: { kind: "project", projectName: "Demo", branchName: "main" },
      exportedAt: FIXED_NOW,
    });
    const headingLine = md.split("\n").find((l) => l.startsWith("## 1."));
    if (!headingLine) throw new Error("expected a heading line in markdown output");
    // 80-char cap = 77 chars + "…"
    expect(headingLine.endsWith("…")).toBe(true);
    expect(headingLine).toContain(`${"x".repeat(77)}…`);
  });

  test("omits screenshot row when no screenshot asset is present", () => {
    const md = renderAnnotationsMarkdown([makeAnnotation({ assets: [] })], {
      scope: { kind: "project", projectName: "Demo", branchName: "main" },
      exportedAt: FIXED_NOW,
    });
    expect(md).not.toContain("**Screenshot:**");
  });

  test("omits filter line when all filters are 'all' or absent", () => {
    const md = renderAnnotationsMarkdown([makeAnnotation()], {
      scope: { kind: "project", projectName: "Demo", branchName: "main" },
      filters: { status: "all", intent: "all", severity: "all" },
      exportedAt: FIXED_NOW,
    });
    expect(md).not.toContain("Filters:");
  });

  test("renders multiple annotations separated by --- dividers", () => {
    const md = renderAnnotationsMarkdown(
      [
        makeAnnotation({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", commentText: "first" }),
        makeAnnotation({ id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", commentText: "second" }),
      ],
      {
        scope: { kind: "project", projectName: "Demo", branchName: "main" },
        exportedAt: FIXED_NOW,
      }
    );
    expect(md).toContain("## 1. [to_do] [fix] [blocking] first");
    expect(md).toContain("## 2. [to_do] [fix] [blocking] second");
    // header divider + one between annotations
    expect((md.match(/^---$/gm) ?? []).length).toBe(2);
  });

  test("trailing newline so concatenation/file output is clean", () => {
    const md = renderAnnotationsMarkdown([makeAnnotation()], {
      scope: { kind: "project", projectName: "Demo", branchName: "main" },
      exportedAt: FIXED_NOW,
    });
    expect(md.endsWith("\n")).toBe(true);
  });
});
