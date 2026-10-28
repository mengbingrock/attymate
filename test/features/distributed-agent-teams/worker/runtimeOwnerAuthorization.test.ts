// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { personIdSchema, type RuntimeOwnerRequest } from '@claude-teams/agent-teams-protocol';
import { WorkerRuntimeOwnerAuthorization } from '@claude-teams/agent-teams-worker';
import { afterEach, describe, expect, it, vi } from 'vitest';

const alice = personIdSchema.parse('51000000-0000-4000-8000-000000000001');
const bob = personIdSchema.parse('51000000-0000-4000-8000-000000000002');
const resources: WorkerRuntimeOwnerAuthorization[] = [];
afterEach(() => {
  while (resources.length) resources.pop()!.close();
  vi.restoreAllMocks();
});
async function identity(
  personId = alice,
  dir?: string,
  keys: Parameters<typeof WorkerRuntimeOwnerAuthorization.open>[2] = []
) {
  const path = dir ?? (await mkdtemp(join(tmpdir(), 'runtime-owner-key-')));
  const auth = await WorkerRuntimeOwnerAuthorization.open(path, personId, keys);
  resources.push(auth);
  return { auth, path };
}
const request = (): RuntimeOwnerRequest => ({
  operation: 'session.open',
  sessionId: randomUUID(),
  scope: {
    teamId: randomUUID(),
    nodeId: randomUUID(),
    assignmentId: randomUUID(),
    attemptId: randomUUID(),
    leaseEpoch: 1,
  },
});
const expiry = () => new Date(Date.now() + 90_000).toISOString();

describe('device-local runtime owner authorization', () => {
  it('requires a signature for the locally pinned owner, not a claimed person ID', async () => {
    const a = (await identity()).auth;
    const b = (await identity(bob)).auth;
    const input = request();
    expect(() => b.authorize(input, undefined, expiry())).toThrow('Device-owner authorization');
    expect(() => b.authorize(input, { ...a.sign(input), personId: bob }, expiry())).toThrow(
      'Device-owner authorization'
    );
    expect(() => b.authorize(input, a.sign(input), expiry())).toThrow('Device-owner authorization');
    b.authorize(input, b.sign(input), expiry());
    expect(b.hasSession(input.sessionId, input.scope)).toBe(true);
  });

  it('binds authorization to device, task, lease epoch and session', async () => {
    const { auth } = await identity();
    const input = request(),
      proof = auth.sign(input);
    for (const field of ['nodeId', 'teamId', 'assignmentId', 'attemptId'] as const)
      expect(() =>
        auth.authorize(
          { ...input, scope: { ...input.scope, [field]: randomUUID() } },
          proof,
          expiry()
        )
      ).toThrow();
    expect(() =>
      auth.authorize({ ...input, scope: { ...input.scope, leaseEpoch: 2 } }, proof, expiry())
    ).toThrow();
    expect(() => auth.authorize({ ...input, sessionId: randomUUID() }, proof, expiry())).toThrow();
    auth.authorize(input, proof, expiry());
  });

  it('requires a fresh signature for the exact control payload', async () => {
    const { auth } = await identity();
    const input = request();
    auth.authorize(input, auth.sign(input), expiry());
    const control = {
      controlId: randomUUID(),
      type: 'filesystem.read',
      payload: { path: 'authorized.txt' },
    };
    const action: RuntimeOwnerRequest = { ...input, operation: 'runtime.control', control };
    const proof = auth.sign(action);
    expect(() =>
      auth.authorize(
        { ...action, control: { ...control, payload: { path: 'other.txt' } } },
        proof,
        expiry()
      )
    ).toThrow();
    auth.authorize(action, proof, expiry());
    expect(() => auth.authorize(action, proof, expiry())).toThrow();
  });

  it('does not allow a control proof to open another session or vice versa', async () => {
    const { auth } = await identity();
    const input = request(),
      proof = auth.sign(input);
    expect(() =>
      auth.authorize({ ...input, operation: 'runtime.control', control: {} }, proof, expiry())
    ).toThrow();
    expect(() =>
      auth.authorize(
        { ...input, operation: 'runtime.control', control: {} },
        auth.sign({ ...input, operation: 'runtime.control', control: {} }),
        expiry()
      )
    ).toThrow();
  });

  it('rejects expired proofs and does not extend an expired execution lease', async () => {
    const { auth } = await identity();
    const input = request(),
      now = Date.now(),
      proof = auth.sign(input);
    vi.spyOn(Date, 'now').mockReturnValue(now + 31_000);
    expect(() => auth.authorize(input, proof, expiry())).toThrow();
    vi.restoreAllMocks();
    expect(() =>
      auth.authorize(input, auth.sign(input), new Date(now - 1).toISOString())
    ).toThrow();
  });

  it('persists consumed nonces across Worker restarts', async () => {
    const first = await identity();
    const input = request(),
      proof = first.auth.sign(input);
    first.auth.authorize(input, proof, expiry());
    resources.splice(resources.indexOf(first.auth), 1);
    first.auth.close();
    const second = await identity(alice, first.path);
    expect(() => second.auth.authorize(input, proof, expiry())).toThrow();
  });

  it('persists revocation and invalidates existing sessions and unused old proofs', async () => {
    const first = await identity();
    const input = request();
    first.auth.authorize(input, first.auth.sign(input), expiry());
    const unused = request(),
      oldProof = first.auth.sign(unused);
    first.auth.revoke();
    expect(first.auth.hasSession(input.sessionId, input.scope)).toBe(false);
    expect(() => first.auth.authorize(unused, oldProof, expiry())).toThrow();
    resources.splice(resources.indexOf(first.auth), 1);
    first.auth.close();
    const second = await identity(alice, first.path);
    expect(() => second.auth.authorize(unused, oldProof, expiry())).toThrow();
    second.auth.authorize(unused, second.auth.sign(unused), expiry());
  });

  it('pairs public keys for the same owner without copying private keys', async () => {
    const primary = await identity();
    const secondary = await identity(alice, undefined, [primary.auth.key]);
    const input = request();
    secondary.auth.authorize(input, primary.auth.sign(input), expiry());
    const file = JSON.parse(await readFile(join(secondary.path, 'runtime-owner-key.json'), 'utf8'));
    const otherFile = JSON.parse(
      await readFile(join(primary.path, 'runtime-owner-key.json'), 'utf8')
    );
    expect(file.privateKey).not.toBe(otherFile.privateKey);
    const bad = await mkdtemp(join(tmpdir(), 'runtime-owner-foreign-'));
    await expect(
      WorkerRuntimeOwnerAuthorization.open(bad, bob, [primary.auth.key])
    ).rejects.toThrow('Only keys belonging');
  });

  it('refuses to relabel an existing owner key as a different employee', async () => {
    const first = await identity();
    await expect(WorkerRuntimeOwnerAuthorization.open(first.path, bob)).rejects.toThrow(
      'identity changed'
    );
  });

  it.skipIf(process.platform === 'win32')(
    'rejects shared-readable and symlinked owner key files',
    async () => {
      const first = await identity();
      await chmod(join(first.path, 'runtime-owner-key.json'), 0o644);
      await expect(WorkerRuntimeOwnerAuthorization.open(first.path, alice)).rejects.toThrow(
        'owner-only'
      );
      const directory = await mkdtemp(join(tmpdir(), 'runtime-owner-link-'));
      await symlink(
        join(first.path, 'runtime-owner-key.json'),
        join(directory, 'runtime-owner-key.json')
      );
      await expect(WorkerRuntimeOwnerAuthorization.open(directory, alice)).rejects.toThrow(
        'owner-only'
      );
    }
  );
});
