# Account dashboard

This server-owned module extends the existing standalone relay portal. It remains in the
distributed relay package because it runs independently of Electron; the feature facade in
`src/features/distributed-agent-teams` continues to own the Electron integration.

- `googleAuth.ts`: Google authorization code flow, PKCE and verified OIDC identity. Uses JOSE
  against Google's published signing keys; verifies signature, issuer, audience, expiration,
  nonce, authorized party and verified email. Requests only `openid email profile`.
- `accountStore.ts`: account membership, single-use invitations, hashed sessions and device
  credentials in owner-only `relay-accounts.sqlite`. It never stores Google identity/access
  tokens as application sessions. Google subject IDs, rather than email addresses, identify users.
- `accountRoutes.ts`: input validation, session/CSRF checks and user-scoped orchestration.
- `accountAssets.ts`: standalone dashboard, invite acceptance and device/chat setup views.
  Dynamic values use DOM text nodes. Credentials are not persisted in browser storage.

The installer gateway forwards account cookies, CSRF and Origin headers to the core relay.
It preserves both OAuth Set-Cookie headers and forwards redirects without following them.
Native builds stay in the gateway: authenticated installation requests get a user/team-scoped
device credential from the relay, then the gateway streams the matching existing native archive.
The credential binds to the first advertised node and cannot enroll a different node afterward.

People join through an invitation before installing a device. Account owners administer
invitations; this is distinct from a Codex agent's `lead`/`member` role. New teams are private
and use peer coordination by default. Accepted membership persists without a connected device.
Invitations expire in seven days, can optionally restrict an email, and can be revoked by owners.
Opening an invite never accepts it automatically. An existing member opens their dashboard
without consuming a fresh invitation.

The setup panel includes native downloads, linking an existing device with its private pairing
code, opening a team chat, attaching an existing idle chat, and selecting a default for new chats.
Runtime and computer selectors show the selected installation’s local App Server start, status,
and client commands immediately, without downloading an installer. The instructions remain
available when no installer build is published for the selection. Downloads are a separate optional
action. macOS/Linux use a private Unix socket; Windows uses an authenticated loopback WebSocket
with an installer-selected port. The Worker connects to a local relay on loopback, which forwards
team messaging to the AWS relay. This relay connection is separate from the local Codex App
Server socket. Stock reuses the existing Codex login and opens the desktop app by default on macOS.
Terminal attachment is optional; no new sign-in is started by the stock installer.
Switching runtime/platform selections updates the installation commands, including
the separate `-stock` installation directory.

Automatic messages currently enter the most recently attached chat for that membership. The UI
shows this explicitly; another unbound personal chat does not acquire incoming messages merely
by inspecting the team tools. Devices and the active team's roster refresh while the page is open.

Each device card has **Remove device**, followed by an explicit confirmation. The authenticated
POST checks ownership, CSRF/Origin, and the node binding shown at confirmation; a device that
connected after a waiting entry was selected must be reviewed again. Removal revokes the stored
installation credential, marks its team memberships left, releases their assignments, and closes
that node's current relay connection. Other devices and account membership are retained. An active
lead with teammates must be transferred first. Shared legacy credentials are not rotated; the
removed membership cannot automatically rejoin. Local files, Codex login, and chats are retained;
use that installation's `bin/uninstall.sh` locally to remove its service and owned MCP registration.
Reconnect a removed installation with a fresh installation directory and credential.

## Live team presence

The account dashboard separates **Computer connected** from **Online**. Online requires an
authorized active membership, a fresh Worker heartbeat, and a fresh live client attachment to
that membership's team chat. Stored chats, MCP configuration, background message delivery,
and the dashboard being open do not establish session presence. Idle attached clients count;
presence does not imply that a person is viewing the chat or that the model is running.

The desktop bridge validates the team binding and MCP inventory after thread start/resume,
then reports an ephemeral connection ID through the private Worker control socket. It checks
both client and App Server transports with WebSocket ping/pong every five seconds. Session
evidence expires after fifteen seconds. Closing either transport, successful thread unsubscribe
or archive, or loss of the Worker's App Server connection clears the attachment. Worker restart
requires a new client attachment. Multiple sessions are scoped independently by team and membership.

Worker heartbeats retain the relay-advertised interval (two seconds by default; stale after six).
They carry the age of independently observed session health, never refreshing it just because
the Worker itself is alive. Both ends use monotonic elapsed time for expiry. A missing heartbeat
acknowledgement makes the Worker reconnect. Presence expiry does not change execution leases,
delete memberships, cancel tasks, or launch model turns.

Presence is negotiated using the authenticated WebSocket upgrade header
`x-agent-teams-presence: 1` and `relay.welcome.presenceVersion`. The local relay forwards this
capability. Old Workers receive the unchanged welcome shape; new Workers omit session fields
when talking to an old relay. Older installations display session status unavailable. Rebuild
and ship the Worker, local relay, and desktop bridge together for either stock or bundled Codex.
Clients connecting directly to App Server (including the optional direct terminal attachment)
bypass this bridge and cannot establish verified session presence.

The portal polls every two seconds, expires displayed evidence independently of polling, and
shows status unavailable after refresh failures. Open team chat remains available when the
computer is connected but the member is offline. Removing a device immediately revokes presence.
This implementation covers the account dashboard and its team roster; legacy directory APIs
continue exposing their existing connection semantics.

Verification includes `teamPresence.test.ts`, `sessionPresence.test.ts`, desktop bridge and
chat service tests, and the dashboard tests. All runtime fixtures use disposable projects and
identities; heartbeat tests require no model calls or user login.

## Configuration

Use the downloaded Google **Web application** OAuth JSON, stored outside the repository with
mode `0600`, and set `AGENT_TEAMS_GOOGLE_CLIENT_FILE` to its absolute path on the core relay.
The relay reads its `web.client_id` and `web.client_secret`. Add `--accounts` to the installer
gateway, which does not need the Google secret. Both services require their existing
`--public-url` setting. The registered callback is `<public-url>/join/auth/google/callback`.

The account portal requires HTTPS except on loopback for isolated tests. Session cookies are
HttpOnly and SameSite=Lax, with Secure enabled on HTTPS. Mutations require the configured
public Origin and the signed-in session's CSRF token. Login state is tied to a separate browser
cookie and consumed once. Session and invitation lifetimes are seven days; login state lasts
ten minutes. Google publication/testing settings are managed in Google Cloud Console.

The old directory and device-pairing page remains at `<public-url>/join/?legacy=1`; existing
team tokens and worker identities continue working. Existing legacy teams are not silently
assigned to a Google account. The account dashboard lists teams created or joined by that account.

## Verification

`accountPortal.test.ts` exercises token validation, OAuth cookies through the real loopback
gateway, CSRF, account isolation, restricted invitations, acceptance, session persistence,
installer delivery, node enrollment and cross-user device access. `accountDashboard.test.ts`
checks the sign-in view, safe rendering, team creation and explicit invite acceptance/setup.
Browser verification uses disposable loopback teams and identities before testing real Google
sign-in on the deployed relay. Never add a production fake-login route or provider flag.
