// @vitest-environment node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { withCodexConfigLock } from '../../../../packages/agent-teams-worker/src/codexConfigTransaction';
import {
  publishLockFile,
  withLockReclamation,
} from '../../../../packages/agent-teams-worker/src/processLockFile';
import { acquireWorkerProcessLock } from '../../../../packages/agent-teams-worker/src/workerProcessLock';

const helper = resolve('packages/agent-teams-worker/src/processLockFile.ts');
const worker = resolve('packages/agent-teams-worker/src/workerProcessLock.ts');
const config = resolve('packages/agent-teams-worker/src/codexConfigTransaction.ts');

describe('crash-safe process lock publication and reclamation', () => {
  let root: string;
  const children: ReturnType<typeof spawn>[] = [];
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agt-process-lock-'));
  });
  afterEach(async () => {
    await Promise.all(
      children.splice(0).map(async (child) => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      })
    );
    await rm(root, { recursive: true, force: true });
  });
  const childScript = async (name: string, source: string) => {
    const path = join(root, name + '.mts');
    await writeFile(path, source);
    const child = spawn(process.execPath, ['--import', 'tsx', path], { stdio: 'pipe' });
    children.push(child);
    return child;
  };

  it('publishes complete ownership exclusively and ignores interrupted unpublished temporaries', async () => {
    const path = join(root, 'lock');
    await writeFile(path + '.crashed-writer.tmp', '');
    expect(publishLockFile(path, 'complete')).toBe(true);
    expect(publishLockFile(path, 'replacement')).toBe(false);
    expect(await readFile(path, 'utf8')).toBe('complete');
  });

  it('recovers a reclaimer killed before completing its immutable generation', async () => {
    const path = join(root, 'worker-process.lock');
    await writeFile(path, JSON.stringify({ pid: 2147483647, token: 'exited-worker' }));
    await writeFile(path + '.reclaim', '');
    const child = await childScript(
      'crashed-reclaimer',
      `
      import { withLockReclamation } from ${JSON.stringify(helper)};
      withLockReclamation(${JSON.stringify(path)}, () => process.kill(process.pid, 'SIGKILL'));
    `
    );
    const [, signal] = await once(child, 'exit');
    expect(signal).toBe('SIGKILL');
    const release = await acquireWorkerProcessLock(root);
    expect(JSON.parse(await readFile(path, 'utf8')).pid).toBe(process.pid);
    const records = await readdir(path + '.reclaims');
    expect(records).toContain('0000000000000001.json');
    expect(records).toContain('0000000000000002.json.done');
    expect(records).not.toContain('0000000000000001.json.done');
    release();
  });

  it('never enters reclamation while a live generation is executing', () => {
    const path = join(root, 'lock');
    const operation = vi.fn();
    expect(
      withLockReclamation(path, () => {
        expect(withLockReclamation(path, operation)).toBe(false);
      })
    ).toBe(true);
    expect(operation).not.toHaveBeenCalled();
    expect(withLockReclamation(path, operation)).toBe(true);
    expect(operation).toHaveBeenCalledOnce();
  });

  it('fails closed on invalid immutable ownership without removing the primary lock', async () => {
    const path = join(root, 'worker-process.lock');
    const original = JSON.stringify({ pid: 2147483647, token: 'dead' });
    await writeFile(path, original);
    mkdirSync(path + '.reclaims');
    writeFileSync(join(path + '.reclaims', '0000000000000001.json'), '{}');
    await expect(acquireWorkerProcessLock(root)).rejects.toThrow('Invalid process lock identity');
    expect(await readFile(path, 'utf8')).toBe(original);
  });

  it('allows only one of eight independent Worker processes to own an abandoned identity', async () => {
    const path = join(root, 'worker-process.lock');
    await writeFile(path, JSON.stringify({ pid: 2147483647, token: 'dead' }));
    const contenders = await Promise.all(
      Array.from({ length: 8 }, async (_, index) => {
        const child = await childScript(
          'worker-' + index,
          `
        import { acquireWorkerProcessLock } from ${JSON.stringify(worker)};
        process.stdin.resume();
        try {
          const release = await acquireWorkerProcessLock(${JSON.stringify(root)});
          console.log('owner');
          process.stdin.once('data', () => { release(); process.exit(0); });
        } catch { console.log('rejected'); process.exit(0); }
      `
        );
        let output = '';
        let errors = '';
        child.stderr!.on('data', (data) => {
          errors += data;
        });
        const result = new Promise<string>((done, reject) => {
          child.stdout!.on('data', (data) => {
            output += data;
            if (output.includes('\n')) done(output.trim());
          });
          child.once('exit', () => {
            if (!output) reject(new Error(errors));
          });
        });
        return { child, result };
      })
    );
    const results = await Promise.all(contenders.map(({ result }) => result));
    expect(results.filter((value) => value === 'owner')).toHaveLength(1);
    expect(results.filter((value) => value === 'rejected')).toHaveLength(7);
    const owner = contenders[results.indexOf('owner')]!.child;
    const exited = once(owner, 'exit');
    owner.stdin!.end('release');
    expect(await exited).toEqual([0, null]);
    await expect(readFile(path)).rejects.toThrow();
  });

  it('serializes independent config transactions after a dead guard and primary owner', async () => {
    const configPath = join(root, 'config.toml');
    const lock = configPath + '.agent-teams.lock';
    await writeFile(lock, JSON.stringify({ pid: 2147483647, token: 'dead' }));
    await writeFile(lock + '.reclaim', '');
    mkdirSync(lock + '.reclaims');
    writeFileSync(
      join(lock + '.reclaims', '0000000000000001.json'),
      JSON.stringify({ pid: 2147483647, token: 'dead-guard' })
    );
    await writeFile(configPath, '0');
    const contenders = await Promise.all(
      Array.from({ length: 6 }, async (_, index) => {
        const child = await childScript(
          'config-' + index,
          `
        import { withCodexConfigLock } from ${JSON.stringify(config)};
        import { mkdirSync, rmdirSync, readFileSync, writeFileSync } from 'node:fs';
        for (let i = 0; i < 6; i++) await withCodexConfigLock(${JSON.stringify(configPath)}, async () => {
          mkdirSync(${JSON.stringify(join(root, 'critical-section'))});
          const count = Number(readFileSync(${JSON.stringify(configPath)}, 'utf8'));
          await new Promise(done => setTimeout(done, 5));
          writeFileSync(${JSON.stringify(configPath)}, String(count + 1));
          rmdirSync(${JSON.stringify(join(root, 'critical-section'))});
        });
      `
        );
        let errors = '';
        child.stderr!.on('data', (data) => {
          errors += data;
        });
        return once(child, 'exit').then(([code]) => {
          if (code !== 0) throw new Error(errors);
        });
      })
    );
    await Promise.all(contenders);
    expect(readFileSync(configPath, 'utf8')).toBe('36');
    await withCodexConfigLock(configPath, async () => undefined);
  });
});
