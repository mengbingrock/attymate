# matter-dashboard

Live litigation Matter Dashboard for a team, kept current by the **team lead
agent** through a batched, user-confirmed update flow. Follows the
[Feature Architecture Standard](../../../docs/FEATURE_ARCHITECTURE_STANDARD.md).

## The workflow lives in a skill, not in the app

The instructions the lead follows — initial folder scan, batched update scan,
delegation, grounding rules — are an **ordinary user skill** at
`~/.claude/skills/matter-dashboard/SKILL.md` (and `~/.codex/skills/` when Codex
is set up). `MatterSkillSeeder` writes it once, when the slug is missing, and
never touches it again: the user owns it, edits it like any other skill, and
those edits take effect immediately because `MatterRefreshCoordinator` reads the
file from disk (falling back to the bundled `MATTER_SKILL_MARKDOWN` only when it
is absent). Deleting the folder re-seeds it on the next start.

Lead prompts therefore carry only a ~3-line pointer to the skill. The skill
itself is team- and runtime-agnostic; `buildMatterSkillInvocationPrompt` adds
the situational parts (team, project path, initial scan vs update, and whether
the runtime permits spawning extra specialists — false for codex lanes, decided
by `readTeamRuntimeFacts` from the runtime binding *and* the team's provider so
the answer is still right for a stopped team).

## Update lifecycle (propose → confirm → apply)

The dashboard is NOT updated per task. The flow is:

1. A refresh is requested — either by the user (**Refresh dashboard** in the
   dashboard header → `matter:request-refresh`) or automatically when a job's
   last task completes (`TeamDataService.notifyLeadOnJobWrapUp`, which delegates
   to `requestJobWrapUpRefresh`). Both paths deliver the same skill-backed
   message through `sendUserInstructionToLead`. A team that has never launched
   has no lead to address: that returns `accepted: false` with an explanation
   rather than throwing.
2. The lead calls MCP tool `matter_get`, compiles a list of what the completed
   work changed (derived from task comments/results), and calls
   `matter_propose` with that summary plus only the changed sections. This
   writes `~/.claude/teams/<team>/matter-proposal.json` — nothing else.
3. The dashboard renders the pending proposal (summary + per-section diff)
   with **Approve & update** / **Reject** buttons.
4. Approve → `TeamDataService.applyMatterProposal` merges the changes into
   `~/.claude/teams/<team>/matter.json` (sections shallow-merge, arrays
   replace wholesale), clears the proposal, and notifies the lead.
   Reject → the proposal is cleared and the reason is sent to the lead's
   inbox to revise and re-propose.

Agents can only propose; the sole writer of `matter.json` is the app on user
approval (`agent-teams-controller/src/internal/matterStore.js`).

## Layers

- `contracts/` — `MatterDto` / `MatterProposalDto` (fixture-faithful v1
  schema), tolerant normalizers, IPC channels + HTTP route, and the skill slug
  that lead prompts across the app name.
- `core/domain/matterSkillDefinition.ts` — the SKILL.md markdown that is seeded
  to the user's skill roots.
- `main/` — read-only `MatterFileReader`, `createMatterFeature` composition
  (apply/reject delegate to `TeamDataService`), IPC + HTTP adapters.
- `preload/` — `createMatterBridge`.
- `renderer/` — `MatterDashboardView` (demo fixture + live overlay + proposal
  review panel) and `useMatter` (fetch + refetch on `team-change` events of
  type `matter`).

## Live updates

`matter.json` / `matter-proposal.json` are watched by the existing teams
watcher (`TeamTaskWatchRegistry` allowlist + `FileWatcher.processTeamsChange`
classify them as `TeamChangeEvent { type: 'matter' }`). The renderer store
ignores these events; only `useMatter` refetches.

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
  sends it to the lead. The lead projects only grounded changes through the
  existing `matter_propose` review gate.

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

Link never writes `matter.json`; user approval remains the only apply path.

## Known limitations

- Human inline edits in the view are local component state only: they are not
  persisted and reset when the next approved update lands.
- The wrap-up nudge fires only when a completion leaves zero active tasks on
  the board; boards with long-lived unrelated open tasks rely on the standing
  prompt instruction alone.
