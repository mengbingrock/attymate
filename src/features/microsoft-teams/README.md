# Microsoft Teams pilot

This process-limited feature connects authenticated personal Teams messages to an
existing distributed Worker. It uses the public distributed framework facade and
its lease-scoped runtime controls. Relay, Worker, membership and lease ownership
remain in the existing framework.

`main/index.ts` is the server entry point. `contracts/` contains provider-neutral
request and binding types. `core/application/TeamsGateway.ts` enforces the pilot
identity allowlist and request deduplication. Runtime and SQLite adapters live in
`main/infrastructure/`. The Microsoft SDK transport is the small standalone package
`packages/agent-teams-teams-adapter`.

The pilot supports personal message/reply, worker status, and automatic delivery
of later completed turns on the bound lead runtime. Enrollment
uses verified tenant and Entra object IDs; email and display names do not grant
access. Channel chats are rejected. Requests with uncertain delivery are not
automatically resubmitted. `TeamsApprovalDelivery` sends pending local approvals
to the explicitly enrolled device owner in their personal Teams conversation.
The Worker can use explicitly selected existing work connections. The adapter
returns final answers and keeps intermediate agent commentary out of Teams replies.
Older runtimes without message phases use the last assistant message.

`TeamsResultDelivery` observes the existing lease-scoped runtime stream. It does
not start model turns, resend peer messages, or change Relay/Worker execution.
The authenticated personal conversation is saved in the private SQLite journal.
Both the direct reply and the background observer use the same assignment,
attempt, lease epoch, and turn delivery key, so a completed turn is sent once.
Only current configured owners can receive queued replies.

Pending sends survive an adapter restart. A send that was in flight when the
adapter stopped, or whose HTTP outcome is uncertain, is marked `unknown` and is
not automatically repeated. This prevents blind duplicate sends; it is not a
claim of exactly-once delivery by Teams. A new or truncated runtime subscription
does not replay history and reports a coverage diagnostic. Results completed
while no subscription existed may require checking the runtime manually.

`PilotIngress` optionally shares one ngrok free development domain between the
existing adapter and Relay. It binds to loopback, forwards only the Teams POST,
the two static notices, and the exact Worker WebSocket upgrade path. Bot JWTs
and Worker bearer headers reach their existing authenticators unchanged. Relay
manager APIs and other paths are not published. The package `ingress.ts` entry
point runs this transport separately from both framework processes.

The optional `/pilot-updates/<sha256>.zip` route serves code-only update bundles
from `TEAMS_PILOT_UPDATES_DIR` using GET or HEAD. Configuration, tokens, login
data and private workspace files must never be placed in that directory.

## Local files, Browser Use and Computer Use

These capabilities run on each device through its existing private Codex App
Server. They do not create another task executor. Local file access is an owner
opt-in (`--local-access-config`); writes retain Codex's normal sandbox approvals.
`--computer-use` selects the locally installed official unified Computer Use
transport, which contains both Browser Use and native app operations. Available
Chrome/Edge backends come from that device's installed Codex component. It does
not copy vendor binaries or another chat's browser access identity.

Approvals are bound to the device owner, personal conversation, execution lease,
thread, turn, App Server generation, and pending request. `ownedNodes` explicitly
enrolls additional computers belonging to the same owner; a manager role grants
no staff-device approval authority. The SQLite approval journal prevents blind
replays after ambiguous sends or clicks. The owner can send `approval status`:
a fresh Worker snapshot must confirm the exact request still pending before a
new card is shown, including when a previously shown card has expired. Only the
newest card for that RPC is eligible, and obsolete leases are skipped. That
command grants no permissions and starts no model turn.

Teams can relay supported Codex approvals, choices and ordinary MCP forms.
Secret input and unsupported nested forms remain on the local owner interface.
First-time operating system permissions (such as macOS Accessibility or Screen
Recording) still need to be granted on the device. Native tools appearing in an
inventory does not establish that browser or desktop operations work; test both.

Owner requests include a delivery note asking the agent to put the actual answer
in its final message. An internal framework result submission does not replace
the answer that the existing Teams outbox forwards to the owner.

A synchronous reply wait can expire while a delegated task is still running.
The adapter then checks a fresh runtime snapshot through the existing facade.
It reports work in progress only when the original dispatch was acknowledged
and the same thread, turn and App Server generation are active. It never starts
or steers a second turn to check status. Unconfirmed or changed status retains
the unknown-delivery response; the existing observer delivers a later final reply.

Task-scoped approvals use the existing `approval.resolve` control and the private
SQLite approval journal. The Teams card offers `Allow for this task` for the
official `cua_repl.js` transport, low-risk exact native-app access, and exact
browser-origin access. Grants require an acknowledged owner decision and match
the owner, private conversation, device, assignment/attempt/lease, thread, turn
and App Server generation. Repeated requests in that scope are resolved without
new cards. A new turn or resource requires a new owner decision. High-risk
requests, sensitive actions beyond origin access, commands, files and forms do
not gain automatic approval. Vendor settings and permanent allow lists are not
modified.

The Teams invoke makes one immediate receipt read, then returns a pending
confirmation if the Worker has not replied. The original control ID and event
cursor are saved before dispatch. Background reads reconcile that exact receipt
and enqueue one confirmation through the existing delivery outbox. Neither
timeout, duplicate click nor adapter restart resubmits an approval. Lost event
coverage remains unknown and does not create a grant. An explicit
`approval status` may replace a still-pending card after a fresh Worker snapshot;
it does not reissue approvals whose receipt is still being checked.

## Validation status

This is a draft pilot for review against the existing distributed framework.
On October 23, 2026, all 207 tests in the 57 distributed-framework and Teams test
files passed. Root and standalone adapter typechecks passed. Focused Teams lint
reported no errors and five warnings; this is not a full desktop release check.

Separate live tests used synthetic inputs:

- Authenticated Teams personal messages, status and English final replies.
- A Mac lead delegating a synthetic calculation to a Windows member, receiving
  the peer reply and automatically returning a result to Teams.
- Owner-selected read connections on the Mac, with account checks.
- Owner-named synthetic Downloads files, an example.com page and Calculator
  operations on each device independently.
- Teams approvals on each device, repeated consent within one runtime turn,
  delayed receipt confirmation and rejection of a new turn after a decline.

**Not yet accepted:** the complete flow from one Teams instruction through Mac
delegation, Windows local browser/desktop actions, owner approval, the peer reply
and the combined final Teams result. The Windows UI tests were initiated through
the existing owner runtime control separately from the synthetic peer-message
test; they do not establish acceptance of the combined workflow.

Other limits remain explicit:

- Teams dispatches to the binding's primary node. Device targeting is delegated
  by that lead; there is no native `/windows` or `/mac` routing command.
- `Allow for this task` is scoped to one runtime turn and exact resource. It
  does not grant access across turns or to other devices.
- Runtime subscription gaps and ambiguous Teams sends are reported without
  automatic replay. Complete catch-up across outages is not guaranteed.
- Device-specific installation, OS permissions, login startup and a full
  firm-wide rollout still require their own acceptance checks.

Only generic source, tests and documentation are intended for this review.
Personal enrollment settings, credentials, runtime databases, logs, test files
and local deployment scripts are excluded from the proposed changes.
