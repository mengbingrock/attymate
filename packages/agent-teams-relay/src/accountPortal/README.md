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
action. macOS/Linux use a private Unix socket; Windows uses an
authenticated loopback WebSocket with an installer-selected port. The online Worker relay is
identified separately as the team messaging connection. Switching runtime/platform selections
updates the installation commands, including the separate `-stock` installation directory.

Automatic messages currently enter the most recently attached chat for that membership. The UI
shows this explicitly; another unbound personal chat does not acquire incoming messages merely
by inspecting the team tools. Devices and the active team's roster refresh while the page is open.

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
