# Distributed Agent Teams

Manager-side integration for Relay-backed workers and remote assignments.

- `contracts/` is browser-safe and defines the IPC DTO surface.
- `core/` contains transport-independent use cases and ports.
- `main/` owns Relay HTTP access and Electron IPC registration.
- `preload/` exposes the validated renderer API.

The Relay is currently configured with `AGENT_TEAMS_RELAY_URL` and defaults to
`http://127.0.0.1:43170`. This feature never exposes the Relay URL as an
arbitrary renderer-supplied network target.
