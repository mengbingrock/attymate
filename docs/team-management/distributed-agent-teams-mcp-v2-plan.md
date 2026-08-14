# Distributed Agent Teams MCP v2

## Summary

The current MCP is single-machine: it writes directly to local `~/.claude` state through `mcp-server/src/controller.ts`, while Codex teammates run in one local tmux session through `src/features/interactive-team-runtime/main/CodexTeamLanesService.ts`. Its loopback HTTP services have no network trust model and must not be exposed over the LAN unchanged.

Build an opt-in distributed mode with this topology:

```text
Lead/manager PC                         Teammate PC
----------------                       -----------
Agent Teams Manager (Electron)         Stock Codex app
        |                              | local control MCP
Headless Worker                        STDIO control bridge
        |                              | owner-scoped local IPC
        |                              v
        |                       Headless Worker
        |                         |- private Codex App Server
        |                         `- runtime MCP profile
        +---------------+   +-----------------+
                        v   v
                Company-LAN Team Relay
          shared tasks, messages, calendars,
          commands, progress, results, audit
```

Ship three separately installable products: the full **Agent Teams Manager** Electron application for leads/managers, the **Agent Teams Worker** headless service for every participating PC, and the standalone **Agent Teams Relay** for the company server. The Manager installer includes or installs a local Worker for the lead; a teammate installs only the Worker and uses the stock Codex app as the human-facing control surface.

Use local STDIO MCP because Codex supports it directly and shares MCP configuration among the desktop app, CLI, and IDE extension on the same Codex host. Keep Codex App Server local over stdio/Unix transport; its remote WebSocket transport is documented as experimental and unsupported for production. App Server supplies the required thread, turn, steering, interruption, and streamed-event APIs. See the [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) and [Codex App Server documentation](https://learn.chatgpt.com/docs/app-server).

## Architecture and behavior

- Build the Agent Teams Worker as a standalone service and CLI with no Electron, Chromium, or renderer dependency. It starts at login, owns one persistent local Codex App Server process, and survives both the Manager and stock Codex app closing.
- Keep the Electron application as the lead/manager control plane. It provides team creation, placement, launch, monitoring, calendars, messages, review, and migration screens, and communicates through the lead's local Worker rather than owning remote runtime processes itself.
- Give teammates no required Agent Teams GUI. Their stock Codex app launches a small owner-control STDIO MCP bridge, which talks to the already-running Worker over an OS-user-scoped Unix socket or Windows named pipe. A CLI and native OS notifications cover setup, service health, and approvals when Codex is closed.
- Give each person one logical personal-agent identity, unified timeline, shared queue, and serial execution slot. Underneath, use a personal native Codex thread plus scoped threads per team/repository assignment; never reuse one native thread across unrelated teams. Only one turn per person runs at once.
- Support mixed placement:
  - `embedded`: manager-hosted, app-owned automation executing on the lead's or another manager-controlled node.
  - `personal`: a human member's persistent headless Worker; it never implies a teammate-side Electron installation.
  - Local versus remote is derived by comparing the placement node with the lead node; both use the same relay protocol.
- Persist one active node binding per person in v2.0. No automatic multi-device failover or Wake-on-LAN. Work queues until an offline node reconnects.
- Pre-authorized remote start is a node-local policy covering team, repository, provider/model, sandbox roots, network/tool limits, working hours, maximum duration, and auto-push permission. Every assignment is revalidated before execution. The lead may cancel work but cannot approve a remote shell/tool request.
- Separate worker lifetime from assignment lifetime. `team_stop` cancels queued work and fences active attempts; it never kills a personal worker or its App Server. Closing or quitting the Manager only detaches the lead UI. Existing app-shutdown process killing remains limited to legacy local runtimes; stopping a headless Worker requires an explicit local service command.
- Use durable assignment states:

```text
proposed -> accepted/rejected/deferred -> queued
-> leased -> preparing_workspace -> running <-> waiting_local_approval
-> verifying -> committing -> awaiting_push -> reporting
-> ready_review -> completed

Terminal alternatives: cancelled | failed | fenced
```

- Grant a lease only when an assignment reaches the head of the serial queue. Use a 90-second lease, 20-second heartbeat, monotonic local deadline, and increasing fencing epoch. Every progress, push, and result event carries the epoch; stale attempts cannot publish or complete.
- During a disconnect, do not start queued team jobs. An active job may continue only until its lease expires, then the worker interrupts Codex and quarantines the worktree. Reconnect uses durable cursors and returns `continue`, `resume`, `fence`, or `already_committed`.
- Stock Codex control messages never enter a background execution thread implicitly. `assignment_steer` explicitly targets the active assignment and exact `turnId`; task-related relay messages may use the same checked path, while unrelated team or personal messages remain queued for a later turn.
- Extend the existing App Server JSON-RPC client to support persistent sessions, thread/turn contracts, streamed notifications, and server-initiated approval or user-input requests. Do not silently drop server requests with numeric IDs.
- Map each logical repository to a node-local clone. Every attempt gets an isolated worktree from an immutable base SHA and branch `agent-teams/<team>/<task>/<attempt>`. The worker—not the model—commits and pushes an explicit refspec. Never modify the user's active checkout, force-push, or auto-merge.
- Completion requires a confirmed push plus relay compare-and-swap. Results include repository ID, base/head SHA, branch, diff digest, test summary, artifacts, and optional PR URL.

## Public contracts and MCP surface

Create stable opaque IDs for organizations, people, nodes, worker instances, local control sessions, teams, memberships, workspaces, work items, attempts, approval requests, conversations, calendar events, and artifacts. Names become presentation fields only.

```ts
type CoordinationMode = 'local_filesystem_v1' | 'lan_relay_v2';

type AgentPlacement =
  | { kind: 'embedded'; hostNodeId: string; slotId: string }
  | { kind: 'personal'; personId: string; nodeId: string };

interface CommandEnvelope {
  protocolVersion: 2;
  commandId: string;
  sequence: number;
  teamId?: string;
  targetNodeId: string;
  expectedRevision?: number;
  leaseEpoch?: number;
  expiresAt?: string;
  type: string;
  payload: unknown;
}
```

- The standalone relay uses Fastify, WebSocket, SQLite/WAL, and a blob directory. It owns shared work items, memberships, task/review state, conversations, calendar mirrors and mutation queues, command history, revisions, delivery cursors, and result metadata.
- Each worker owns local paths, worktrees, Codex threads/transcripts, provider credentials, calendar OAuth tokens, consent policy, approvals, and a durable SQLite inbox/outbox. Calendar providers remain authoritative; the relay stores the complete normalized event mirror.
- Delivery is at least once with idempotency keys, monotonic relay cursors, optimistic record revisions, acknowledgements, replay, and size/rate limits. Relay-backed mutations are not reported as applied until acknowledged.
- Keep the existing `agent-teams` MCP namespace and schemas unchanged. V2 uses two capability-separated MCP profiles served by the same Worker distribution:
  - `agent-teams-control`: registered in the owner's stock Codex configuration and connected through the local STDIO bridge. It is the teammate-facing management surface.
  - `agent-teams-runtime`: injected only into Worker-owned background App Server threads. It contains the minimum tools required to execute the currently leased assignment.
- Start background App Server threads with an isolated configuration overlay and explicit runtime-tool allowlist so they cannot inherit `agent-teams-control` from the owner's global Codex configuration. The runtime profile never exposes approval responses, worker policy, service control, membership/placement, or manager lifecycle tools.
- The control bridge uses an owner-only Unix socket or Windows named pipe protected by OS account permissions. Installation updates Codex MCP configuration idempotently without replacing unrelated servers. Models never supply authoritative `from`, `actor`, `memberName`, `nodeId`, `cwd`, `claudeDir`, `controlUrl`, PID, or runtime-session identity.
- Define the owner-control surface as:
  - `agent_context`, `worker_status`, `worker_enable/disable/restart`, and `agenda_get`
  - `assignment_list/get/accept/reject/defer/status/pause/resume/cancel/steer/activity_get`
  - `progress_get`, `result_get`, `message_list/send`, and support/review tools
  - `approval_list/get/respond`
  - `worker_policy_get/update` and `remote_start_history`
  - `personal_task_list/create/update/complete`
  - `calendar_list` and `calendar_event_list/get/create/update/delete`
- Define the background runtime surface as active-assignment context, existing task/comment/review operations, `message_send`, `progress_report`, `result_submit`, support requests, calendar reads, and policy-checked calendar change proposals. All identity, team, attempt, lease, and workspace fields come from the Worker's active execution slot.
- Keep `team_launch`, `team_stop`, `team_member_start/stop/status`, placement, membership, and migration operations Manager-only. They are available through the Electron Manager and may be exposed to a lead-scoped control MCP session, never to a teammate runtime profile.
- Treat `approval_respond`, worker-policy changes, direct calendar mutations, publishing, cancellation, and service stop operations as user-confirmed control MCP writes. `approval_respond` is device-local, cannot traverse the relay, and requires a fresh owner confirmation. A lead command can create a pending local approval but can never answer it.
- Do not require the stock Codex app to attach to the Worker's exact live App Server connection or native thread. The Worker exposes a structured activity projection, summaries, messages, pending approvals, and results through MCP; native transcripts remain local and can be inspected only through an explicit owner-local diagnostic/export action.
- Hide `runtime_bootstrap_checkin`, `runtime_deliver_message`, `runtime_task_event`, and `runtime_heartbeat` from both MCP profiles; these become Worker-to-Relay protocol events. Keep host-local `process_*` and `matter_*` v1-only.
- Local attachment paths are accepted only by the local gateway and must resolve inside approved roots. The relay receives only blob IDs, hashes, MIME types, and sizes.

## Unified queue, calendar, messaging, and management surfaces

- Use one `WorkItem` model for personal and team work, retaining origin, scope, audience, requested priority, effective priority, scheduling authority, dependencies, progress, review, and result references.
- Leads can inspect a member's complete unified queue, but cannot rewrite or complete personal tasks. Each lead controls its own team-task definition and requested priority; the personal agent computes the effective cross-team order.
- Full connected Google and Microsoft calendar details are visible to every lead of that member, and those leads may create, update, move, or delete events. Peers receive no calendar access.
- Calendar credentials stay on the member PC. Lead edits become pending relay commands; the member worker refreshes the provider event and conditionally applies them. Use Google sync tokens and ETags and Microsoft calendar-view delta links and provider versions. Never silently overwrite a conflicting provider edit. See [Google incremental sync](https://developers.google.com/workspace/calendar/api/guides/sync), [Google conditional updates](https://developers.google.com/workspace/calendar/api/guides/version-resources), and [Microsoft event delta](https://learn.microsoft.com/en-us/graph/delta-query-events).
- Poll providers incrementally from member nodes; do not depend on public webhooks. Handle time zones, all-day events, tombstones, attendee-notification warnings, and recurrence scopes `this occurrence` and `entire series`.
- Store messages as team, direct, task, support, or review conversations. Peer support shares a bounded task-context snapshot; review requests pin work-item revision and Git/artifact hashes. Changing reviewed content invalidates prior approval.
- The Agent Teams Manager Electron UI shows node placement and health, queue position, requested versus effective priority, runtime state, calendar details and conflicts, peer conversations, progress, Git results, review state, and team migration controls.
- The teammate manages their Worker in the stock Codex app through MCP: unified agenda, active scope, remote-start history, activity summaries, messages, approvals, support/review requests, calendar operations, and pause/cancel/disable controls.
- The headless package provides `agent-teams-worker setup`, `status`, `diagnose`, `enable`, `disable`, `start`, `stop`, `restart`, `update`, and `uninstall` commands. Setup verifies a supported, authenticated local Codex runtime; accepts the relay URL and enrollment code; maps approved repository clones; records remote-start policy; performs Google/Microsoft OAuth through the system browser or device-code flow; installs the login service; and registers the control MCP bridge.
- Send native OS notifications for new assignments, pending approvals, calendar conflicts, and failed/blocked work. If the stock Codex app is closed, background work continues until it needs an approval; it then pauses without auto-approving and waits for the owner to respond through Codex or the local CLI.
- Raw Codex transcripts and private reasoning remain on the member PC. Leads see shared projections, queue data, calendar data, messages, progress, and results—not the native conversation history.

## Implementation, migration, and verification

- Maintain four process-safe deliverables:
  - **Agent Teams Manager:** the existing Electron application extended with canonical `distributed-agent-teams` lead/manager UI and main-process adapters.
  - **Agent Teams Worker:** a standalone headless Node service, service-management CLI, local SQLite store, Codex App Server supervisor, calendar/Git adapters, and STDIO MCP bridge. Its production dependency graph must not include Electron, Chromium, renderer code, or lead-only UI.
  - **Agent Teams Relay:** a separately deployable Node service for company-LAN coordination.
  - **Shared protocol/core:** browser-safe contracts and pure personal-agent/team-domain policies imported through public entrypoints by all three products.
- Keep teammate-owned execution out of Electron main. Extend `src/main/services/team/runtime/TeamRuntimeAdapter.ts` with placement, node, lease, attempt, and cursor contracts for the Manager's orchestration view while retaining current local adapters.
- Refactor task/message/review rules behind repository ports. Keep the current filesystem adapter for v1 and add relay-backed repositories for v2; never dual-write.
- Ship the relay as a standalone Node CLI with explicit host, port, data directory, trusted CIDRs, health/readiness endpoints, graceful shutdown, schema migration, backup, and restore commands. Nodes use a manually configured relay URL; no automatic discovery.
- Ship the Worker as a standalone artifact for macOS, Windows, and Linux, with launch-at-login/service registration, version compatibility checks against the relay, state-preserving upgrades, and an uninstall option that separately asks whether local queue/thread metadata should be retained. The Manager installer installs the same Worker artifact for the lead rather than maintaining a second runtime implementation.
- Make MCP registration idempotent and reversible: add or update only the user-facing `agent-teams-control` entry, preserve all other Codex configuration, verify the owner-scoped Worker socket during setup, and remove only the owned entry during uninstall. `agent-teams-runtime` is a Worker-injected execution profile and is never added to the owner's global MCP configuration.
- Migration offers:
  - `clone`: create an independent distributed copy while leaving v1 active.
  - `move`: back up and import the local team, then mark the local source read-only with a distributed redirect.
- Migration generates stable team/member IDs, preserves task/message/comment IDs and timestamps, maps historical names to memberships, records unresolved actors as labels, uploads attachments, and imports cross-team links only when both teams exist on the same relay.
- The Manager initiates team migration and creates enrollment records. Each teammate independently enrolls their Worker, maps local clones, accepts local remote-start policy, connects calendars, and enables login startup. Manager migration never copies teammate OAuth credentials, Codex authentication, native transcripts, local paths, or approval history off that teammate's PC.
- Deliver in three gated increments:
  1. Shared protocol, standalone relay, installable headless Worker/CLI/MCP bridge, stable identities, placement, replay, and v1 compatibility.
  2. Manager orchestration UI, remote lifecycle, scoped Codex threads, peer messaging, teammate MCP management, approvals, task/review/progress flows, Git worktrees, and auto-push.
  3. Unified personal queue, Google/Microsoft calendars, full lead editing, enrollment/migration, native notifications, backup, packaging, and operational documentation.
- Required tests:
  - Preserve all existing local MCP and tmux behavior.
  - Run the Manager with an embedded-local member and a separate teammate harness that contains the headless Worker and Codex MCP client but no Electron process; complete assignment, start, progress, support, review, push, and result.
  - Verify the teammate artifact has no Electron/Chromium/renderer runtime dependency and can install, start at login, update, diagnose, and uninstall independently.
  - Verify MCP setup preserves unrelated Codex configuration and that the stock Codex app/CLI can list agenda and activity, message peers, pause/cancel work, manage calendars, and answer owner-local approvals.
  - Assert that background App Server threads receive only `agent-teams-runtime`; attempts to discover or invoke owner-control, approval-response, policy, service, placement, or manager tools fail closed.
  - Verify duplicate/out-of-order delivery, reconnect replay, offline queues, lease expiry, stale fencing epochs, App Server restart reconciliation, and cancellation.
  - Prove two personal turns cannot run concurrently and Team B messages cannot enter Team A's native thread.
  - Verify remote leads cannot answer local approvals, closing the teammate's Codex app does not stop ordinary background work, approval-required work pauses and notifies, and quitting the Manager does not terminate any headless Worker.
  - Verify the teammate can manage background work through structured MCP projections without attaching to the Worker's live App Server connection.
  - Exercise first-run enrollment, missing or logged-out Codex runtime, relay/Worker version skew, service restart, control-bridge reconnect, state-preserving upgrade, diagnostics, and both state-retaining and state-removing uninstall paths.
  - Exercise two disposable Git clones and a bare remote, including wrong-repository mapping, branch collision, push rejection, and stale-result rejection.
  - Contract-test Google and Microsoft incremental sync, recurring events, time zones, conditional edits, provider conflicts, offline edits, and failed mutations.
  - Verify Manager IPC/HTTP parity, teammate MCP parity, management-surface role filtering, attachment limits, path containment, backup/restore, and clone/move migration.
  - Run all live team checks only against new disposable projects and fake calendar accounts.

## Fixed assumptions for v2.0

- Leads/managers install the full Agent Teams Manager Electron application. Teammates are not required to install Electron and receive only the standalone Agent Teams Worker, MCP bridge, and CLI.
- Every participating PC still requires a local Codex installation/account. The Worker runs background Codex App Server sessions; the teammate uses the stock Codex app, CLI, or IDE extension to manage those sessions through MCP projections.
- Direct attachment of the stock Codex app to the Worker's live App Server connection is out of scope for v2.0.
- Remote personal agents use Codex; existing local non-Codex runtimes remain supported only through legacy mode.
- Each person has one primary node and one personal execution slot.
- Remote start is pre-authorized, Git task branches auto-push, and privileged actions still require the device owner.
- The company LAN/VPN is the sole trust boundary. The relay uses plaintext `http://` and `ws://`, with no TLS, device authentication, or end-to-end encryption.
- Consequently, IDs and role checks provide routing and accidental-use protection only. Any machine that can reach the relay can impersonate a lead, read plaintext team/calendar data, or submit calendar changes. The service must be restricted to configured private CIDRs, never port-forwarded, and permanently labeled **Insecure LAN mode** in the Manager, Worker status/context output, CLI, and documentation.
