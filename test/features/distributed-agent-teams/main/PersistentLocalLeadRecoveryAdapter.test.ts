import { EventEmitter } from 'node:events';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PersistentLocalLeadRecoveryAdapter } from '@features/distributed-agent-teams/main/infrastructure/PersistentLocalLeadRecoveryAdapter';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChildProcess } from 'node:child_process';

const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const NODE_ID = '11111111-1111-4111-8111-111111111111';

const roots: string[] = [];

const preparePersistentLead = async (nodeId = NODE_ID): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'persistent-lead-recovery-'));
  roots.push(root);
  const directory = join(root, TEAM_ID);
  await mkdir(directory, { mode: 0o700 });
  await writeFile(
    join(directory, 'lead.json'),
    JSON.stringify({ version: 1, teamId: TEAM_ID, nodeId }),
    { mode: 0o600 }
  );
  await writeFile(join(directory, 'start-worker.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await chmod(join(directory, 'start-worker.sh'), 0o700);
  return root;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('PersistentLocalLeadRecoveryAdapter', () => {
  it('spawns only the fixed launcher beneath the validated team directory', async () => {
    const root = await preparePersistentLead();
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() }) as unknown as ChildProcess;
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    });
    const adapter = new PersistentLocalLeadRecoveryAdapter({
      root,
      spawnProcess,
      processExists: () => false,
    });

    await expect(adapter.reconnect({ teamId: TEAM_ID, nodeId: NODE_ID })).resolves.toEqual({
      status: 'started',
    });
    expect(spawnProcess).toHaveBeenCalledWith(
      join(root, TEAM_ID, 'start-worker.sh'),
      [],
      expect.objectContaining({ cwd: join(root, TEAM_ID), detached: true, stdio: 'ignore' })
    );
    expect(child.unref).toHaveBeenCalled();
  });

  it('returns already-running for a live pid without spawning', async () => {
    const root = await preparePersistentLead();
    await writeFile(join(root, TEAM_ID, 'worker.pid'), '4321\n');
    const spawnProcess = vi.fn();
    const adapter = new PersistentLocalLeadRecoveryAdapter({
      root,
      spawnProcess,
      processExists: (pid) => pid === 4321,
    });

    await expect(adapter.reconnect({ teamId: TEAM_ID, nodeId: NODE_ID })).resolves.toEqual({
      status: 'already-running',
    });
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('refuses a manifest for a different Relay lead', async () => {
    const root = await preparePersistentLead('55555555-5555-4555-8555-555555555555');
    const adapter = new PersistentLocalLeadRecoveryAdapter({ root });

    await expect(adapter.reconnect({ teamId: TEAM_ID, nodeId: NODE_ID })).rejects.toThrow(
      'does not match the active Relay lead'
    );
  });
});
