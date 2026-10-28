# Independent-owner validation

## What the boundary does

A manager or peer may send a goal through the existing team protocol. The recipient Agent may use
its owner's authorized local tools to do that work and return a result. There is no business-result
or output-format whitelist.

Private runtime inspection and direct controls require that device owner's signature. A manager
token, a team role, a claimed email, an assignment lease or a Teams binding cannot substitute for
it. The Worker checks this before filesystem access, runtime inspection, steering and approval
resolution. Private runtime events go only to locally authorized owner sessions.

The owner's local client uses private IPC by default. The optional signed remote transport trusts
the Relay with private results; it is not end-to-end encrypted. The existing account portal retains
its separate device-ownership checks. These tests do not establish protection against a compromised
owner OS account, local administrator or every action a malicious Relay could take.

## Automated checks

Run with Node 24.15.x and the repository lockfile:

```sh
pnpm exec vitest run --maxWorkers=1 test/features/distributed-agent-teams test/features/microsoft-teams
pnpm typecheck
pnpm --filter @claude-teams/agent-teams-worker typecheck
pnpm --filter @claude-teams/agent-teams-teams-adapter typecheck
node scripts/build/distributed-worker-bundle.mjs /tmp/owner-boundary-bundle
```

Focused regression coverage:

- A real Relay/Worker transport refuses a manager-only private session.
- Owner-local reads work without manager credentials or private events transiting the Relay.
- The signed owner transport works through pilot ingress; manager APIs and the local signer stay
  unpublished.
- If Relay verification is deliberately bypassed, the Worker still rejects reads, writes, steering
  and approvals. Private file contents and runtime deltas do not enter the unauthorized session.
- An opening proof cannot be changed into an action. Control proofs bind the exact payload, device,
  task, attempt, lease epoch and session. Replayed, expired and revoked proofs are rejected.
- Replay and revocation state survives restarts. Same-owner public-key pairing works; relabeling an
  existing private key for another owner fails.
- Revocation stops further private deltas and controls on existing owner sessions while preserving
  owner-local access. Queued events are checked again before transmission.
- Repeated opening/control failures receive HTTP 429. Spoofed forwarding headers and rotating
  session IDs do not reset the budget or block the separate manager API.
- Existing peer messaging, membership, task lifecycle and owner-approved controls remain covered.

These tests use synthetic data and App Server fixtures. They are not native Windows or Microsoft
account signoff.

## Native two-account acceptance

Use one manager account and a different employee account. Verify both provider object IDs in their
actual signed-in sessions. Record identity confirmation separately from the locally enrolled Worker
person ID; a config email alone does not prove Microsoft sign-in.

1. Back up pilot files and record the code revision and artifact hash. Upgrade Relay, Workers,
   adapter and ingress together. Do not expose the global manager API publicly.
2. Enroll the employee in a separate Worker installation/data directory with fresh identity and
   owner keys. Keep the original owner's installation and history intact. Never pair the manager's
   key into the employee Worker. Keep credentials private on each device.
3. Create a random synthetic file on each device. The manager requests a work goal through normal
   team messaging. The employee Agent reads its own fixture and returns the requested result. Verify
   the device, assignment/message IDs and the result; do not use a pre-disclosed answer.
4. Test the employee's own installed Browser Use and Computer Use with example.com and Calculator.
   Existing local tool authorization remains effective. If approval is required, the employee's
   owner interface resolves it. Confirm the actual tool outcome, not just dispatch acceptance.
5. Try the employee private runtime using manager credentials and a proof from the manager's local
   signer. Both must fail. Attempts to read/change its fixture, steer tools or approve its pending
   request must cause no tool action and disclose no private runtime data.
6. Revoke remote-owner access locally, reconnect/restart the test Worker and retry an unused old
   proof. It must fail. A new local owner authorization can still be issued. Data already delivered
   before revocation cannot be recalled.
7. Verify normal task requests and result delivery still work after the negative checks. Record
   exact timestamps and observed results, including any failures.

A manager-hosted Teams bot has only the manager's signer. It cannot approve the employee's private
operations. This change supplies the employee's local owner client; employee-owned remote Teams
approval signing is not implemented here and must not be marked accepted.

Native Mac/Windows two-account acceptance remains pending until the steps above are observed on
both devices. Do not infer a pass from unit tests or from two devices enrolled to the same person.
