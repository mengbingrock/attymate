# Debugging agent-team launches

Use this runbook when a stock Claude or Codex team launch hangs, a teammate remains registered but not ready, messages do not arrive, or task logs appear stale.

## Safety

- Reproduce only in a new sandbox/test project.
- Stop only processes and tmux sessions owned by the test run.
- Do not kill unrelated tmux sessions or user teams.

## Start with persisted evidence

Inspect the newest launch artifact pack under:

```text
~/.claude/teams/<team>/launch-failure-artifacts/latest.json
```

Open the referenced `manifest.json` and correlate its classification, bootstrap transport breadcrumb, spawn statuses, progress trace, and runtime-adapter trace with the UI error.

Also inspect the team-local state that applies to the selected stock runtime:

- `config.json` and `launch-state.json`
- bootstrap state/journal files
- `interactive-runtime.json` for interactive Claude or Codex lanes
- inbox files for the sender and recipient
- the relevant stock CLI transcript or pane capture

## Stock Claude

Interactive Claude teams run in an app-owned tmux session. Confirm the session exists, its panes are alive, and the stock session-derived team directory was created. The app team name and the stock session-derived team name are intentionally different; use `StockSessionTeamBridge` evidence to correlate them.

For a headless fallback, confirm the lead process is alive and stdin delivery is still available. Headless teammates receive relayed messages through the lead; interactive teammates use stock mailbox files.

## Stock Codex

Codex teams use one interactive stock `codex` TUI per lane. Inspect `interactive-runtime.json`, then verify every declared tmux window exists and its latest pane lines show a usable prompt rather than a trust dialog, authentication failure, or exited process.

Inbound app messages are pasted into the recipient lane. If a message stalls, compare the app inbox state with the target pane and the lane message-pump diagnostics.

## Minimal verification loop

1. Create a disposable test project and team.
2. Launch either an all-Claude or all-Codex team.
3. Wait for every requested member to become ready.
4. Send one user-to-member message and one member-to-user reply.
5. Stop the team from the app.
6. Confirm the app-owned process or tmux session is gone and unrelated sessions remain.

Do not change parsing, readiness, or delivery code until persisted evidence identifies which boundary failed.
