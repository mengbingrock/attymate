# matter-dashboard

Live litigation Matter Dashboard for a team, kept current by the **team lead
agent** through a batched, user-confirmed update flow. Follows the
[Feature Architecture Standard](../../../docs/FEATURE_ARCHITECTURE_STANDARD.md).

## Update lifecycle (propose → confirm → apply)

The dashboard is NOT updated per task. The flow is:

1. A related series of tasks (a job) completes. The app nudges the lead once
   when the board goes quiet (`TeamDataService.notifyLeadOnJobWrapUp`); the
   standing lead-prompt instruction
   (`buildLeadMatterDashboardInstructions`) is the primary driver.
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
  schema), tolerant normalizers, IPC channels + HTTP route.
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

## Known limitations

- Human inline edits in the view are local component state only: they are not
  persisted and reset when the next approved update lands.
- The wrap-up nudge fires only when a completion leaves zero active tasks on
  the board; boards with long-lived unrelated open tasks rely on the standing
  prompt instruction alone.
