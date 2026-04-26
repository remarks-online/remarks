// Surfaced in `remarks_whoami.skill_version` (Phase 2 spec §3.2). The actual
// SKILL.md ships in task 2.14; until then, agents see "unreleased" so they
// don't try to compare against an absent skill version. Replace with the
// real frontmatter `version:` once 2.14 lands (Phase 2 spec §4.1 example:
// `2026-04-22`).
export const SKILL_VERSION = "unreleased";
