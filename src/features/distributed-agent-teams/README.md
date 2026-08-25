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
