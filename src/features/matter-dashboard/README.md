# matter-dashboard

Litigation Matter Dashboard over the app's **global, team-independent matters
store**, kept current by direct user edits and by the **team lead agent**
through a batched, user-confirmed update flow. Follows the
[Feature Architecture Standard](../../../docs/FEATURE_ARCHITECTURE_STANDARD.md).

## Matters are not team data

A matter exists before any team is created and outlives every team. Storage is
therefore the app's own model-agnostic location (Electron `userData`), never a
runtime-branded path:

```text
<userData>/matters/<matterId>/matter.json   one matter document (schema v2, no team fields)
<userData>/matters/team-links.json          { [teamName]: matterIds[] } — many-to-many
<userData>/matters/proposals/<team>.json    the team's pending proposal
```

`agent-teams-controller/src/internal/matterStore.js` stays the ONLY writer; the
app supplies the store path via the controller context (`mattersDir`) and the
`AGENT_TEAMS_MATTERS_DIR` env var (which also reaches the MCP server processes).
Any team can link to any matter; matter documents carry no team knowledge.

**Legacy migration is lazy**: the first read of a team that still has a v1
`~/.claude/teams/<team>/matter.json` imports it into the store (v1→v2 field
mapping in `contracts/normalize.ts`), links the team, moves any pending
proposal, and stubs the old file with `{ migratedTo }` so it never imports
twice.

## Schema v2 (the Matter Dashboard v3 template)

`contracts/dto.ts` mirrors the v3 design: named scalars
(`client`/`caseNumber`/`department`, back-filled from core-field labels),
`parties[]` + `counsel[]` (linked by `partyId`), pleading `records[]` grouped by
filing party, discovery `motions[]`/`meetAndConfers[]` plus richer requests/
productions/depositions, trial settings/continuances/pretrial filings/MILs/
sessions/verdicts, a new `settlement` stage (records + mediations), post-judgment
`enforcementActions[]`, workspace `dir` links on records, and manual-only
`events[]`. `normalizeMatterChanges` accepts BOTH v1 and v2 shapes, so leads
running a cached v1 skill keep working.

## Three write paths, one store

1. **User edits (direct)** — every field in the matter view is editable.
   `useMatterEditor` keeps a per-section draft, debounces whole-section flushes
   through `matter:update`, and reconciles store echoes without clobbering
   unflushed edits. Writes stamp `updatedBy: 'user'`. No proposal gate.
2. **Agent proposals (gated)** — the lead calls `matter_get` /
   `matter_propose { matterId? }`; the proposal renders as a summary +
   per-section diff with **Approve & update** / **Reject** (a staleness note
   appears when the matter changed after submission). Approving merges
   (objects shallow-merge, arrays replace wholesale) and notifies the lead;
   a matterless team's first approved proposal creates and links the matter.
3. **Matter management** — create, link, unlink from the list view
   (`matter:create`, `matter:link-team`, `matter:unlink-team`).

Every store write broadcasts `matter:changed` to the renderer; `useMatter`
refetches on it (plus legacy `team-change` matter events).

## The workflow lives in a skill, not in the app

The instructions the lead follows are an **ordinary skill**, stored where every
runtime can reach it rather than inside one runtime's folder:

- `<userData>/skills/library/matter-dashboard/` — the machine-wide copy.
  `MatterSkillSeeder` writes it when missing, upgrades a **pristine** older seed
  in place (hash-gated against `LEGACY_SKILL_SHA256`), and adopts the edited
  `~/.claude` or `~/.codex` copy that older builds wrote. A user-edited copy is
  never overwritten.
- `<userData>/skills/teams/<team>/matter-dashboard/` — the team's own copy,
  seeded from the library by `TeamMatterSkillProvisioner`. It is what that
  team's lead follows and what travels in the team's export bundle, so two teams
  can run different versions of the workflow.

`SkillProjectionService` symlinks the machine-wide library into
`~/.claude/skills` and `~/.codex/skills`. At launch it projects the team's copy
into the current project's `.claude/skills` and `.codex/skills`, whose project
precedence selects the right team's workflow without making the team depend on
that launch folder. Pointers never overwrite a hand-made skill, and a team's
pointers are reclaimed when the team stops.

`buildMatterSkillInvocationPrompt` **references** the skill by name and absolute
path — the lead reads the file itself — and inlines the body only when the copy
could not be prepared. When the copy has drifted from the bundled text it still
appends the authoritative section schema so proposals arrive in the current
shape. The refresh prompt also names the target matter (`matterId`) or, for
multi-matter teams, tells the lead to pick one via `matter_get`.

## Renderer (v3 layout)

`renderer/ui/` is decomposed: `MatterDashboardView` (shell: list | matter |
history routing), `MattersListView` (search, status chips, link/unlink, new
matter), `MatterCorePanel` + `NextDeadlineCard`, `PartiesPanel`, `StageRail`
(five stages incl. Settlement & Mediation), `panes/*` per stage,
`ProceduralHistoryView`, `ProposalReviewPanel`, `LinkEvidencePanel`,
`matterTheme` (tone system) and `fieldPrimitives`. Without a team the view
renders the demo fixture (`demoFixture.ts`).

**Procedural history** is a projection: `core/domain/proceduralHistory.ts`
derives auto events from the stage records on render — editing a source record
updates the timeline with zero sync machinery. Only manual events are stored.

## Link evidence provider

`createMatterFeature` resolves a team's configured project path and asks
`LinkMatterEvidenceSourceAdapter` for provider-neutral evidence operations. A
status check runs:

```text
lnk ingest-status <project-path> --json
```

It normalizes Link's provider-specific states and counts before they cross IPC
or HTTP. The dashboard then offers explicit operations:

- **Initialize Link** runs `lnk init <project-path>` and rechecks status. It is
  user-triggered because it creates Link's generated wiki structure inside the
  configured project folder.
- **Ask lead to ingest** sends the lead a safety-gated Link ingestion request
  for pending/stale sources. The app does not generate source pages itself.
- **Build proposal from Link** runs five bounded `lnk query ... --budget medium
--json` calls, prefers substantive context-packet extracts over abbreviated
  recall capsules, deduplicates the evidence, fingerprints the packet, and
  sends it to the lead (naming the active matter). The lead projects only
  grounded changes through the existing `matter_propose` review gate.

Electron and browser clients use the same feature operations. Link's
MIT-licensed indexing and retrieval source is vendored under `vendor/link` and
included as an unpacked application resource. It is trimmed to the dashboard's
`init`, `ingest-status`, and `query` contract; unrelated Link CLI and web features
are not shipped. Local development and packaged builds prefer that source, so a
separate Link clone or global installation is not required.
Python 3.10+ must still be available. Runtime selection order is:

1. `AGENT_TEAMS_LINK_COMMAND` — explicit executable override.
2. `AGENT_TEAMS_LINK_SCRIPT` through `AGENT_TEAMS_LINK_PYTHON` (defaults to
   `python3`).
3. Vendored `vendor/link/link.py` in development or the packaged Link resource.
4. Global `lnk` resolved from the enriched application PATH.

See `THIRD_PARTY_NOTICES.md` and `vendor/link/UPSTREAM.md` for the upstream
citation, MIT license, and base revision.

Link never writes matter documents; user edits and user approval are the only
apply paths.

## Known limitations

- One pending proposal per team (last write wins), and array sections replace
  wholesale — an approved proposal can overwrite records the user added after
  it was submitted (the review panel warns when the matter is newer than the
  proposal).
- Dev and packaged builds use different `userData` roots, so they see
  different matters stores.
- Two teams that migrated copies of the same legacy matter.json each get their
  own matter (no content dedupe).
- The wrap-up nudge fires only when a completion leaves zero active tasks on
  the board; boards with long-lived unrelated open tasks rely on the standing
  prompt instruction alone.
