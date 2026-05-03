import {
  INTENT_LABEL,
  INTENT_VARIANT,
  SEVERITY_LABEL,
  SEVERITY_VARIANT,
  STATUS_LABEL,
  STATUS_VARIANT,
} from "@/components/annotations/status-ui";
import {
  INTENT_DESCRIPTIONS,
  SEVERITY_DESCRIPTIONS,
  STATUS_DESCRIPTIONS,
  TARGET_TYPE_DESCRIPTIONS,
} from "@/lib/schema-doc-content";
import {
  ANNOTATION_INTENTS,
  ANNOTATION_SEVERITIES,
  ANNOTATION_STATUSES,
  ANNOTATION_TARGET_TYPES,
} from "@remarks/shared";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@remarks/ui";

export function SchemaEnums() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Classification enums</CardTitle>
        <CardDescription>
          Status is required; intent and severity are optional. Target type is set by the picker.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <EnumSection title="intent" subtitle="What the author wants done.">
          {ANNOTATION_INTENTS.map((value) => (
            <EnumRow
              key={value}
              code={value}
              label={INTENT_LABEL[value]}
              description={INTENT_DESCRIPTIONS[value]}
              badge={<Badge variant={INTENT_VARIANT[value]}>{INTENT_LABEL[value]}</Badge>}
            />
          ))}
        </EnumSection>

        <EnumSection title="severity" subtitle="Triage priority.">
          {ANNOTATION_SEVERITIES.map((value) => (
            <EnumRow
              key={value}
              code={value}
              label={SEVERITY_LABEL[value]}
              description={SEVERITY_DESCRIPTIONS[value]}
              badge={<Badge variant={SEVERITY_VARIANT[value]}>{SEVERITY_LABEL[value]}</Badge>}
            />
          ))}
        </EnumSection>

        <EnumSection
          title="status"
          subtitle="Lifecycle state. `acknowledged` is set only by agents."
        >
          {ANNOTATION_STATUSES.map((value) => (
            <EnumRow
              key={value}
              code={value}
              label={STATUS_LABEL[value]}
              description={STATUS_DESCRIPTIONS[value]}
              badge={<Badge variant={STATUS_VARIANT[value]}>{STATUS_LABEL[value]}</Badge>}
            />
          ))}
        </EnumSection>

        <EnumSection title="targetType" subtitle="Which target field is populated.">
          {ANNOTATION_TARGET_TYPES.map((value) => (
            <EnumRow key={value} code={value} description={TARGET_TYPE_DESCRIPTIONS[value]} />
          ))}
        </EnumSection>
      </CardContent>
    </Card>
  );
}

function EnumSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="space-y-0.5">
        <h3 className="text-sm font-medium">
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">{title}</code>
        </h3>
        {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

function EnumRow({
  code,
  label,
  description,
  badge,
}: {
  code: string;
  label?: string;
  description: string;
  badge?: React.ReactNode;
}) {
  return (
    <li className="grid gap-x-3 gap-y-1 sm:grid-cols-[max-content_max-content_1fr] sm:items-baseline">
      <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">{code}</code>
      <div className="text-xs">{badge ?? (label ? <span>{label}</span> : null)}</div>
      <p className="text-sm text-muted-foreground">{description}</p>
    </li>
  );
}
