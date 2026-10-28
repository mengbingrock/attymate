// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  prepareWorkerIdentity,
  readRuntimeInstallation,
  type RuntimeInstallation,
  saveRuntimeControlMcpTarget,
  writeRuntimeInstallation,
} from '../../../../packages/agent-teams-worker/src/runtimeInstallation';

describe('independent runtime installations', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agt-runtime-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const installation = (runtimeKind: 'stock' | 'fork'): RuntimeInstallation => ({
    schemaVersion: 1,
    installationId: randomUUID(),
    runtimeKind,
    serverOwnership: 'external',
    appServerMode: 'shared-daemon',
    endpoint: '/private/test-owned.sock',
    binaryPath: '/test/codex',
    resolvedBinaryPath: '/test/codex',
    binaryVersion: '0.164.0',
    codexHome: '/test/private-home',
    controlMcpName: 'agent_teams_control_test',
    checkedAt: new Date().toISOString(),
    checks: ['initialize'],
  });

  it('keeps stock and fork metadata separate and refuses an in-place runtime switch', async () => {
    const stock = installation('stock');
    const fork = installation('fork');
    await writeRuntimeInstallation(join(root, 'stock'), stock);
    await writeRuntimeInstallation(join(root, 'fork'), fork);
    await expect(writeRuntimeInstallation(join(root, 'stock'), fork)).rejects.toThrow(
      'another runtime installation'
    );
    expect(await readRuntimeInstallation(join(root, 'stock'))).toEqual(stock);
    expect(await readRuntimeInstallation(join(root, 'fork'))).toEqual(fork);
    await writeRuntimeInstallation(join(root, 'stock'), { ...stock, binaryVersion: '0.165.0' });
    expect((await readRuntimeInstallation(join(root, 'stock')))?.binaryVersion).toBe('0.165.0');
  });

  it('fails closed on corrupted metadata instead of treating it as an unconfigured Worker', async () => {
    await writeFile(join(root, 'runtime-installation.json'), '{"runtimeKind":"stock"}');
    await expect(readRuntimeInstallation(root)).rejects.toThrow();
    expect(await readRuntimeInstallation(join(root, 'absent'))).toBeUndefined();
  });

  it('persists manual enrollment identities across restarts and concurrent first starts', async () => {
    const [first, concurrent] = await Promise.all([
      prepareWorkerIdentity(root, {}),
      prepareWorkerIdentity(root, {}),
    ]);
    expect(concurrent).toEqual(first);
    expect(await prepareWorkerIdentity(root, {})).toEqual(first);
    expect(await prepareWorkerIdentity(root, { nodeId: first.nodeId })).toEqual(first);
    await expect(prepareWorkerIdentity(root, { nodeId: randomUUID() })).rejects.toThrow(
      'saved identity'
    );
    expect(JSON.parse(await readFile(join(root, 'worker-identity.json'), 'utf8'))).toEqual(first);
    const other = await prepareWorkerIdentity(join(root, 'other-runtime'), {});
    expect(other.nodeId).not.toBe(first.nodeId);
  });

  it('cannot race two different runtime installations into the same data directory', async () => {
    const results = await Promise.allSettled([
      writeRuntimeInstallation(root, installation('stock')),
      writeRuntimeInstallation(root, installation('fork')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('merges concurrent startup and registration updates without losing ownership or version evidence', async () => {
    const stock = installation('stock');
    await writeRuntimeInstallation(root, stock);
    const target = {
      command: '/test/node',
      args: ['/test/control.js', '--socket', '/test/control.sock'],
    };
    await Promise.all([
      writeRuntimeInstallation(root, { ...stock, binaryVersion: '0.165.0' }),
      saveRuntimeControlMcpTarget(root, stock.controlMcpName, target),
    ]);
    expect(await readRuntimeInstallation(root)).toMatchObject({
      binaryVersion: '0.165.0',
      controlMcpTarget: target,
    });
    await expect(
      saveRuntimeControlMcpTarget(root, 'agent_teams_control_other', target)
    ).rejects.toThrow('does not match');
  });

  it('rejects edited external-server metadata and invalid registration names on read', async () => {
    await writeFile(
      join(root, 'runtime-installation.json'),
      JSON.stringify({ ...installation('stock'), endpoint: undefined })
    );
    await expect(readRuntimeInstallation(root)).rejects.toThrow(
      'requires a shared-daemon endpoint'
    );
    await writeFile(
      join(root, 'runtime-installation.json'),
      JSON.stringify({ ...installation('stock'), controlMcpName: 'unrelated-server' })
    );
    await expect(readRuntimeInstallation(root)).rejects.toThrow('Invalid Agent Teams control');
  });
});
