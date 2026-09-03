# Distributed Agent Teams

Manager-side integration for Relay-backed workers and remote assignments.

- `contracts/` is browser-safe and defines the IPC DTO surface.
- `core/` contains transport-independent use cases and ports.
- `main/` owns Relay HTTP access and Electron IPC registration.
- `preload/` exposes the validated renderer API.

The Relay is configured with `AGENT_TEAMS_RELAY_URL` and defaults to
`http://127.0.0.1:43170`. This feature never exposes the Relay URL as an arbitrary
renderer-supplied network target.

Interactive Codex runtime sessions additionally require
`AGENT_TEAMS_RELAY_MANAGER_TOKEN` in Electron and `AGENT_TEAMS_RELAY_WORKER_TOKEN` in the Relay and
Workers. Session capability tokens stay inside the main-process Relay adapter. The renderer sees
only lease-scoped DTOs and validated controls.

Every Worker runs Codex App Server with a private Worker-owned `CODEX_HOME` (by default
`<data-dir>/codex-home`). Authenticate that home explicitly with
`CODEX_HOME=<data-dir>/codex-home codex login`; the Worker never imports credentials or personal
plugin/MCP configuration automatically. `--codex-home` selects an explicit private directory, and
the Worker `status`/`diagnose` commands expose its non-secret state.

The implementation follows
[the distributed Codex runtime ADR](../../../docs/team-management/distributed-codex-runtime.md).

## Persistent local leads

Desktop recovery is deliberately limited to lead installations provisioned under:

```text
~/.local/share/agent-teams/distributed-leads/<team UUID>/
├── lead.json
├── start-worker.sh
├── worker.pid
├── config/worker.env
├── data/
├── workspace/
└── worker/
```

`lead.json` binds the directory to the Relay team and lead node IDs. The **Reconnect lead** button
sends only the team ID over IPC. Electron main verifies that the Relay's active lead matches this
manifest, refuses symbolic links or a non-executable launcher, avoids a duplicate live PID, and
starts the fixed launcher detached. Relay and Worker credentials remain in the protected
`config/worker.env`; they are never returned to the renderer.
