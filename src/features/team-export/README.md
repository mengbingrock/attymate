# Team Export

Desktop-only feature that writes a team's agents and their skills to a folder the
[team-import](../team-import/README.md) feature can read back. It is the inverse of import, and
the two share the same contract: export emits `team-import-bundle/v1`, which import ingests
deterministically.

## What is exported

```
<destination>/<team-name>-export/
  team-import-bundle.json        canonical; re-imports with full fidelity, no model call
  agents/<member>.md             Claude-standard subagent definitions (the flat layout the scanner reads)
  skills/<slug>/…                the team's skills (see below)
  TEAM.md                        the lead prompt, when the team has one
  README.md                      how to import the bundle
<destination>/<team-name>-export.zip
```

Emitting both the bundle and the flat markdown layout means the export works with the fast
deterministic path, still degrades to the folder scan if the bundle is removed, and stays
readable by other tools. The folder is the artifact that matters — the zip is for transport, and
a zip failure never fails the export.

## What is deliberately not exported

Agent memory (`agents/<name>/memory/`), `matter.json`, tasks, inboxes, and journals. Those
describe one live case; the export describes a reusable team. Machine-specific text is stripped
too: `members.meta.json` workflows are pointers holding absolute paths into this machine's
`~/.claude/teams/`, so the real workflow is taken from the agent definition or `AGENT.md`
instead.

## Which skills ship

A team's skills live in the team's own store, `<userData>/skills/teams/<team>`, where
[team-import](../team-import/README.md) installs them. So the export ships:

- **the `matter-dashboard` skill for every team**, resolved from the team's copy when present or
  the shared library before first launch, and prioritized so the skill ceiling cannot drop it;
- **everything in the team's store** — that store *is* the team's skill library;
- **plus** the lead's `skills` from `team.meta.json` — the lead is never exported as an agent, so
  nothing else would carry a lead-only skill;
- **plus** anything a member's roster entry or agent definition explicitly names;
- **plus** whatever a legacy team still keeps in `<projectPath>/.claude/skills`.

Shipping the whole library, not just what members reference, is deliberate: a team imported *with*
skills used to export *none*, because attribution lived only in per-member frontmatter the
importer had left empty. Member assignments are read from `members.meta.json` `skills` first,
falling back to `claude-agent-definition.md` frontmatter for teams created before that field
existed. Slugs resolve in ownership order — the exporting team's store, then the shared
`skills/library`, then the catalog (project, then user) — so the team's own copy always wins.

## Fidelity rules

- **The bundle is model- and provider-agnostic.** Roles, workflows, and skills are the portable
  substance; a member's model is runtime configuration of the exporting machine and is never
  written into the bundle. The importing team picks models from whatever provider it launches
  with — a team exported from Claude imports cleanly as a Codex team and vice versa. The importer
  also ignores model pins in bundles from older exports.
- Each member's `claude-agent-definition.md` is reused when present; otherwise an equivalent is
  synthesized with the importer's own `buildClaudeAgentDefinitionMarkdown`, so teams created in
  the UI (which have no `agents/` directory) still export cleanly.
- The lead is never exported as an agent — the app creates it at team creation — but its skills
  are, from `team.meta.json`.
- The importer's ceilings are respected (20 members, 20 skills, 30 files per skill, 64 KiB per
  file). Anything dropped is reported as a warning rather than silently truncated, and members
  whose names the importer would reject are skipped with the reason.

## Layers

- `contracts/` — IPC channel, request/result DTOs, warning codes.
- `core/domain/teamExportPolicy.ts` — team state → bundle → files. Pure, and tested against the
  importer's domain functions in `test/features/team-export/exportImportRoundTrip.test.ts`.
- `core/application/` — the export use case over ports.
- `main/` — filesystem reads of the team directory, skill resolution from the skill store and
  catalog,
  folder + zip writing, the destination picker, and IPC.
- `preload/` — the typed bridge.

Like team-import, this feature is not exposed in HTTP/server mode: it writes to an arbitrary
user-chosen path, which only the desktop folder picker can authorize.
