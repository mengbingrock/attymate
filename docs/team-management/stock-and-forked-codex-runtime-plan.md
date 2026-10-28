# Stock and forked Codex runtime implementation plan

Status: Implemented; critical feature validation passed on macOS arm64. Plan date: 2026-10-26.
See the [validation record](stock-fork-validation.md) for evidence and remaining platform/release gates.

Updated user preference: stock uses the existing cached Codex login and opens the desktop app
by default. This supersedes the original private-home and terminal-first defaults below. Separate
SQLite/log/socket/GUI state remains; the selected login home also shares config and rollout history.

Add an installation path that runs the official, unmodified Codex binary, its built-in App Server,
and its terminal client against the existing Agent Teams Worker and Relay. Maintain the bundled
fork as a supported option. Both kinds of installation must run concurrently on one computer and
participate in the same team, including a stock lead with fork members and a fork lead with stock
members. This plan supersedes the earlier proposal to eventually remove fork packaging.

The first release covers stock terminal attachment and the existing fork client workflows.
Stock desktop GUI attachment is a separate compatibility gate. A2A remains an optional future
gateway for external agents; neither runtime path depends on it.

The responsibilities are shared across both runtime choices:

| Component | Responsibility |
| --- | --- |
| Selected Codex binary | Reasoning, context, native tools, command execution, and sandbox enforcement |
| That binary's App Server | Threads, turns, steering, interruption, activity, and approval requests |
| Team MCP | Member discovery, messages, lead communication, collaboration requests, progress, and results |
| Worker | Local runtime connection, durable delivery, wake-up, lease checks, and recovery |
| Relay | Membership, routing, assignments, and communication between Workers |

All agent-authored team messages use the team MCP tools. Worker-to-Relay transport remains the
existing authenticated connection. App Server is the local execution interface. Neither an agent's
MCP arguments nor a peer message selects an executable, process, or App Server endpoint.

The official CLI documents `app-server --listen unix://PATH` and `agents --remote unix://PATH`.
The local CLI reported version 0.164.0 and exposed these options during planning. That is a
candidate test version, not an established minimum supported version or an end-to-end signoff.
App Server is currently documented as experimental, so releases need a tested compatibility
matrix. See the [official CLI reference](https://learn.chatgpt.com/docs/cli/reference) and
[App Server documentation](https://learn.chatgpt.com/docs/app-server).

1. **Record runtime choice and process ownership explicitly.**

   Add a versioned installation descriptor, implemented and validated in the Worker package. It
   records `installationId`, `runtimeKind: stock | fork`, the selected executable path and observed
   version, `serverOwnership: managed | external`, the endpoint, Codex home, runtime-state location,
   control-MCP registration name, and relevant capability-check results. Secrets stay in the
   existing protected credential files. Local diagnostics expose the selected runtime and precise
   compatibility errors; private paths need not be added to Relay messages.

   Runtime choice and transport are independent. Preserve the existing `private-stdio` and
   `shared-daemon` connection modes. Installer-managed socket sessions continue using
   `shared-daemon`, `--app-server-connect-only`, and an explicit endpoint. The descriptor records
   whether the installation or the operator owns the server process.

   Existing installed directories without a descriptor retain their bundled-fork behavior. Do
   not infer that arbitrary direct-source Worker launches are forked: preserve their current
   executable and transport defaults. New stock installations choose stock explicitly. A runtime
   failure never silently switches to the other kind.

   Resolve the stock executable from an explicit `--codex-binary` or a displayed PATH candidate.
   Persist the chosen path; record its resolved target/version and revalidate changes on startup.
   Version text alone is not proof of official provenance. Fork installations continue using their
   staged manifest and checksum verification.

   Primary files: [Worker CLI](../../packages/agent-teams-worker/src/cli.ts),
   [App Server client](../../packages/agent-teams-worker/src/codexAppServerClient.ts), and
   [diagnostics](../../packages/agent-teams-worker/src/workerDiagnostics.ts).

   Done when legacy fork launch fixtures still pass and each mode reports the executable and
   endpoint it actually uses.

2. **Make simultaneous installations independent.**

   Retain existing fork directories. Give new stock installations a distinct default directory,
   such as `mate-<team-prefix>-stock`. Persist a generated installation ID so socket and service
   names remain unique even for multiple installations of the same kind.

   | Resource | Coexistence rule |
   | --- | --- |
   | Worker data, inbox/outbox, token files, pairing code | Separate per installation |
   | Node and membership identity | Separate registrations; never duplicate an active executor identity |
   | Organization/person identity | May represent the same owner where enrollment supports it |
   | App Server and control endpoints | Separate sockets, named pipes, or authenticated loopback ports |
   | Service, PID files, logs, desktop GUI profile | Separate per installation |
   | SQLite state and session/rollout storage | Never shared between different runtime versions |
   | Execution workspaces | Separate by default; deliberate shared work uses existing assignment/workspace rules |

   New stock installations default to a dedicated Codex home, authenticated using normal stock
   Codex login. Preserve the existing fork login options. Reusing a login home is an optional
   compatibility capability: establish isolation for all writable runtime/session storage before
   supporting it across stock and fork. A separate `sqlite_home` alone does not establish that
   rollout/session files are isolated. Never copy credentials between homes.

   Reject installation of a different runtime kind into an existing directory. Switching kinds
   means creating another installation; no automatic session/database conversion is included.

   Managed supervisors stop only their own server and Worker. In external mode, stopping or
   uninstalling the Worker must not stop the manually started server or unlink its endpoint.
   Reconnection reuses the explicit endpoint and never starts or adopts another daemon.

   Done when both installations run simultaneously, restart independently, and stopping either
   leaves the other's processes, messages, state, and client connection intact.

3. **Fix control-MCP registration for multiple installations.**

   [codexMcpRegistration.ts](../../packages/agent-teams-worker/src/codexMcpRegistration.ts) currently
   manages a single `agent-teams-control` entry. A second setup against the same config can replace
   the first installation's entry. This must be fixed before advertising concurrent operation.

   New installations use a validated name such as `agent_teams_control_<installation-id>` and
   persist that name in their descriptor. Add a registration-name option to setup, inspection,
   diagnostics, and removal. Existing installations keep their legacy name until explicitly
   migrated. Registering a second installation never rewrites the first entry.

   Preserve unrelated TOML settings and MCP registrations. Serialize read/modify/write operations
   across installers, reread before writing, and refuse conflicting external edits. Uninstall
   removes only the registration whose ownership marker and target match that installation.

   Keep the authorization profile named `agent-teams-control`; configuration entry names are
   installation identifiers, not new permission profiles. Update reserved-name checks and runtime
   inventory filtering to recognize all installation control entries. Execution threads must not
   inherit another installation's owner-control tools. The thread-scoped `agent-teams-runtime`
   bridge and its token remain bound to the specific Worker/session.

   Primary files: registration, `workerDiagnostics.ts`, `codexRuntimeConnections.ts`, and
   `codexRuntimeMcpProfile.ts` in the Worker package.

   Done when two installations can register, update, diagnose, and remove their own entries in
   one test Codex config without changing the other entry or gaining its control permissions.

4. **Add stock launchers and preserve the fork launchers.**

   Add `--runtime stock|fork` to installer build configuration, defaulting existing build commands
   to `fork`. Embed the selected kind in the installer artifact. Stock artifacts contain the
   Worker and bridge code and resolve an installed official Codex; fork artifacts retain their
   staged native runtime. A stock artifact must build without `codex-runtime/`. Artifact names
   include the runtime kind. Reject attempts to select a runtime absent from an artifact.

   Support two stock workflows:

   | Workflow | Server lifecycle | Client attachment |
   | --- | --- | --- |
   | Managed stock | Installation starts stock `codex app-server` on its private endpoint and supervises it | Its launcher runs the selected stock `codex agents --remote <endpoint>` |
   | Manual stock | Operator starts stock App Server; Worker connects with existing connect-only flags | Operator or generated launcher attaches stock Codex to the same endpoint |

   The manual workflow needs only the Worker bundle/source, stock Codex, enrollment configuration,
   and an explicit endpoint. It does not require the fork installer. Provide a documented complete
   example retaining stable Worker/node identity and credentials across restarts. Persist credentials
   using the existing protected configuration mechanism, rather than placing tokens in examples or
   shell history. Runtime thread MCP configuration is still injected by the Worker; an unrelated
   new terminal chat does not automatically become a team member session.

   On macOS/Linux use a private Unix socket. On Windows retain the existing authenticated loopback
   WebSocket and named-pipe control pattern, with a separate port and token per installation; probe
   the stock binary's relevant authentication support. Advertise only platform/runtime pairs that
   pass native verification.

   Before accepting assignments, test the selected version's initialize flow, thread start/resume,
   per-thread MCP configuration and inventory, turn lifecycle, approval handling, and terminal
   attachment. Generate version-specific protocol schemas where useful. Full model-turn checks
   belong in isolated smoke tests, not routine installer probes. A socket existing or a help flag
   being present is insufficient readiness evidence. Unsupported versions fail with an actionable
   error while the other runtime installation remains available.

   Shared launcher logic may be extracted after preserving fork regression coverage. Keep binary
   selection and compatibility decisions out of the renderer and shell-string concatenation.
   Validate arguments and pass process argument arrays where possible.

   Primary files: [installer build](../../packages/agent-teams-worker/installer/build-installer.sh),
   [Unix installer](../../packages/agent-teams-worker/installer/install-template.sh),
   [Windows installer](../../packages/agent-teams-worker/installer/install-windows.ps1), and
   [Windows supervisor](../../packages/agent-teams-worker/installer/windows-install.mjs).

   Done when both artifact kinds install successfully, fork package checks remain enforced, and
   manual stock connect-only operation works without any fork files.

5. **Keep one communication contract across both runtimes.**

   Reuse the current runtime MCP, durable inbox/outbox, Relay routing, and App Server supervisor.
   Keep existing tool names and reply routing compatible. Centralize any version-specific App
   Server adaptations inside the Worker adapter, selected from verified capabilities.

   Stage communication improvements separately from binary selection so installer changes cannot
   silently alter existing fork behavior. Both modes must support messages to peers and the lead,
   support/review requests, and progress/results under the existing authorization rules.

   Normalize delivery around an inbox notification: sender calls `message_send`, the Relay routes
   the persisted message, the recipient Worker starts or steers a turn, and the recipient reads
   the message body through MCP and replies through MCP. Preserve the current full-message delivery
   until the inbox-read tools and notification flow pass for both runtime kinds. Existing Workers
   may continue their current delivery behavior during rollout.

   Serialize scheduling per thread, batch ordinary arrivals, and queue messages while waiting for
   approval. Use steering only under the selected delivery policy. Track accepted, delivered,
   processed, and replied states distinctly. Reconcile disconnects before retrying uncertain turn
   submissions; do not promise exactly-once side effects. Suppress acknowledgement loops.

   Communication depends on membership, while managed task execution depends on an assignment
   lease. Use a persistent membership conversation for general questions and explicit task/thread
   routing for assignment work. Preserve the existing lease boundary; a message to an idle member
   does not create task execution authority. The existing desktop-chat membership path can supply
   reusable logic without requiring a desktop GUI.

   Primary files: [Worker delivery](../../packages/agent-teams-worker/src/workerDaemon.ts),
   [runtime supervisor](../../packages/agent-teams-worker/src/codexRuntimeSupervisor.ts),
   [runtime MCP](../../packages/agent-teams-worker/src/runtimeMcpServer.ts), and
   [membership conversations](../../packages/agent-teams-worker/src/desktopChatService.ts).

   Done when stock and fork peers can exchange messages in either direction, including while idle,
   while executing, after task completion, and after a Worker restart.

6. **Offer both choices through installation and management surfaces.**

   Extend the installer catalog to select by `(runtimeKind, platform)`. New portal pages offer
   "Use installed Codex" and "Use bundled team runtime" with available platforms for each.
   Existing requests that omit runtime kind continue selecting the fork, and legacy catalog fields
   continue describing the existing fork downloads. Validate the requested pair before allocating
   an installation credential. New filenames and download metadata identify the selected kind.

   Update both the direct Relay portal and the standalone installer proxy, including account-based
   enrollment. New UI detects the catalog capability and hides unsupported choices against old
   servers. Publish stock availability only after its artifact and native smoke evidence exist.

   Preserve the current Relay Worker wire contract for the first release. Its schemas are strict,
   so adding an optional field to the new schema would still break an old receiver. Keep runtime
   diagnostics local initially; negotiate any later wire-level runtime metadata before sending it.
   Mixed installations should not require simultaneous updates to every Worker.

   Preserve the fork desktop launcher. Gate the stock desktop launcher on a tested desktop/server
   version pair; terminal readiness does not imply GUI compatibility. UI actions use a confirmed
   thread binding, and an unsupported stock GUI action explains how to attach the terminal client.

   Primary files: `relayJoinPortal.ts`, `installerPortalServer.ts`, Relay CLI configuration,
   `relayJoinPortalAssets.ts`, and account-portal routes/assets. Manager changes remain within
   `src/features/distributed-agent-teams` public contracts and adapters, following the
   [feature architecture standard](../FEATURE_ARCHITECTURE_STANDARD.md).

   Done when old download requests still receive working fork installers and a new portal can
   enroll both kinds against the same Relay without overwriting enrollment or pairing state.

7. **Verify coexistence as a release requirement.**

   | Scenario | Required result |
   | --- | --- |
   | Existing fork install/update and client attach | Current behavior and package verification preserved |
   | Fresh stock install | Official binary used; no fork archive required |
   | Manual stock server plus Worker | Both clients share the explicit server; Worker never starts another daemon |
   | Stock and fork on one computer, same team | Distinct identities/endpoints/state; peer messages delivered correctly |
   | Stock lead with fork member, then fork lead with stock member | Assignments, messages, reviews, and results work in both directions |
   | One runtime stopped, upgraded, or uninstalled | Other runtime stays connected and retains its registrations/data |
   | External server ownership | Worker shutdown leaves external process and endpoint intact |
   | Concurrent MCP setup/removal | No lost config edits, registration replacement, or control-tool leakage |
   | Idle/active/approval-blocked/offline recipient | Correct wake, queue, replay, and reply behavior without loops |
   | Lost response, reconnect, expired lease | Reconciled state; no duplicate executor or unauthorized continuation |
   | Stock binary upgraded or missing | Capability check identifies incompatibility; no silent fork substitution |
   | Old/new portal and Relay combinations | Legacy enrollment preserved; unsupported options hidden or rejected |
   | Desktop GUI | Existing fork workflow passes; stock shown only for verified pairs |

   Use disposable teams, Codex homes, and projects for all live checks. Exercise each advertised
   OS/architecture natively; fixture transport tests are not native platform signoff. Keep cleanup
   scoped to test-owned services and processes. Use `pnpm dev:mcp` for Electron UI verification.

   Extend the existing installer, daemon-factory, MCP-registration, token-isolation, portal, and
   delivery tests. Run focused suites, `pnpm lint:fast:files -- <changed files>`, and `pnpm typecheck`
   for TypeScript changes. Before release, run the normal full lint/test/build gates documented in
   [RELEASE.md](../RELEASE.md). Record actual tested versions and results for each runtime pair.

8. **Roll out additively and keep both supported.**

   Deliver reviewable changes in this order: runtime descriptor and compatibility probe; isolated
   registration/state ownership; stock manual connection; dual installer packaging; portal choices;
   shared inbox notification improvements; native mixed-runtime verification and documentation.
   Stock rollout can begin once its existing-compatible messaging path passes, independently of
   later inbox-notification improvements.

   Existing installations remain on their selected runtime. Users add stock alongside fork and can
   stop the stock installation to return to their existing fork workflow. Moving an active member
   or assignment between installations requires the existing stop/fence/reassignment process; it
   is never accomplished by starting both with the same node identity. No automatic transcript or
   database migration is included.

   If a stock release fails validation, withdraw that stock artifact/catalog entry while leaving
   fork downloads and active fork services working. Preserve stock data for diagnosis. Changes to
   shared Worker code must pass both runtime suites before release.

   Update the installer README, distributed-runtime ADR, feature README, and release instructions
   to describe both paths and their tested capabilities. Completion requires passing same-machine
   coexistence and mixed-team checks, not just an installer flag or a successful handshake.
