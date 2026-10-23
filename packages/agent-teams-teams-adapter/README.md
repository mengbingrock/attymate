# Microsoft Teams adapter pilot

This standalone transport connects an enrolled user's personal Teams chat to an
existing distributed Worker. It uses the existing Relay facade, runtime controls,
memberships and execution leases. Each device keeps its own Worker and private
Codex App Server.

This is a review-stage pilot. **The complete workflow from a Teams instruction,
through delegation to Windows desktop tools and owner approval, back to a
combined Teams reply has not yet passed acceptance testing.** See the
[validation status](../../src/features/microsoft-teams/README.md#validation-status)
for the distinction between component tests and that remaining workflow.

## Configuration

Use Node 24 and the repository's pnpm installation. Register a Teams bot and
enroll its intended users explicitly. Supply these environment variables through
the operator's private service configuration:

- `CLIENT_ID`: registered bot application ID.
- `CLIENT_SECRET`: bot secret; keep it outside the checkout.
- `TENANT_ID`: enrolled Microsoft tenant ID.
- `TEAMS_PILOT_CONFIG`: absolute path to the private JSON configuration below.
- `PORT`: optional adapter port, default `3978`.
- `TEAMS_PILOT_UPDATES_DIR`: optional code-only bundle directory; omit when unused.

The following values are placeholders, not an enrolled account or runnable
deployment configuration:

```json
{
  "relayUrl": "http://127.0.0.1:43170",
  "managerToken": "RELAY_MANAGER_TOKEN_PLACEHOLDER",
  "journalPath": "/private/agent-teams/teams.sqlite",
  "bindings": [
    {
      "tenantId": "TENANT_ID_PLACEHOLDER",
      "aadObjectId": "OWNER_ENTRA_OBJECT_ID_PLACEHOLDER",
      "teamId": "EXISTING_TEAM_ID_PLACEHOLDER",
      "nodeId": "OWNER_PRIMARY_NODE_ID_PLACEHOLDER",
      "ownedNodes": [
        {
          "nodeId": "OWNER_SECOND_NODE_ID_PLACEHOLDER",
          "label": "Owner's second computer"
        }
      ]
    }
  ]
}
```

Keep configuration and journals in an owner-only directory outside the checkout
(0700 directories and 0600 files on macOS/Linux; equivalent current-user-only
ACLs on Windows). Bind verified tenant and Entra object IDs, not email addresses
or display names. `ownedNodes` is an explicit owner-device mapping; a manager's
team role does not grant approval authority over staff devices.

With the private environment configured, run:

```sh
pnpm --filter @claude-teams/agent-teams-teams-adapter start
```

The adapter requires existing framework identities and active execution leases.
It does not enroll Workers, create teams, sign users into Codex or install the
official Computer Use component. No personal deployment scripts or credentials
are included in this package.

## Public endpoint

Point the registered bot's messaging endpoint at `/api/messages` through the
operator's HTTPS gateway. Signed Teams authentication remains in the Microsoft
SDK; the adapter also enforces the configured identity and private-chat binding.

For a one-domain development tunnel, the optional `ingress` command listens on
loopback port 43171 and forwards to adapter port 3978 and Relay port 43170:

```sh
pnpm --filter @claude-teams/agent-teams-teams-adapter ingress
```

It publishes only the Teams POST, the exact authenticated Worker WebSocket path,
two static pilot notices and optional hash-addressed code bundles. Relay manager
APIs remain private. Review the notices for the intended deployment before use.
Never put configuration, login files, journals or workspace data in the public
update directory.

## Verification

```sh
pnpm typecheck
pnpm --filter @claude-teams/agent-teams-teams-adapter typecheck
pnpm exec vitest run test/features/distributed-agent-teams test/features/microsoft-teams --maxWorkers=2
```

The [feature README](../../src/features/microsoft-teams/README.md) describes
approval scope, delayed delivery, uncertain outcomes and runtime-stream gaps.
The [runtime guide](../../docs/team-management/distributed-codex-runtime.md)
documents opt-in connections and local device capabilities.
