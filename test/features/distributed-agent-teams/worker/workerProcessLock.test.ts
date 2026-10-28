// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { acquireWorkerProcessLock } from '../../../../packages/agent-teams-worker/src/workerProcessLock';

describe('Worker process ownership', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agt-lock-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it('refuses a duplicate executor and releases only its own lock', async () => {
    const release = await acquireWorkerProcessLock(root);
    await expect(acquireWorkerProcessLock(root)).rejects.toThrow('already in use');
    release();
    const releaseOther = await acquireWorkerProcessLock(root);
    const owner = await readFile(join(root, 'worker-process.lock'), 'utf8');
    release();
    expect(await readFile(join(root, 'worker-process.lock'), 'utf8')).toBe(owner);
    releaseOther();
  });
  it('reclaims a dead process without taking an incomplete startup lock', async () => {
    await writeFile(join(root, 'worker-process.lock'), '{');
    await expect(acquireWorkerProcessLock(root)).rejects.toThrow('may be starting');
    await writeFile(
      join(root, 'worker-process.lock'),
      JSON.stringify({ pid: 2147483647, token: 'dead' })
    );
    const release = await acquireWorkerProcessLock(root);
    expect(JSON.parse(await readFile(join(root, 'worker-process.lock'), 'utf8')).pid).toBe(
      process.pid
    );
    release();
  });
});
