// @vitest-environment node
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, it } from 'vitest';

const start = (args: readonly string[]) => {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', resolve('packages/agent-teams-relay/src/cli.ts'), ...args],
    {
      env: {
        ...process.env,
        AGENT_TEAMS_RELAY_MANAGER_TOKEN: undefined,
        AGENT_TEAMS_RELAY_WORKER_TOKEN: undefined,
        AGENT_TEAMS_GOOGLE_CLIENT_FILE: undefined,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  const ready = new Promise<{ httpUrl: string }>((resolveReady, reject) => {
    let output = '',
      errors = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('CLI startup timed out: ' + errors));
    }, 10000);
    child.stderr!.on('data', (data) => {
      errors += data.toString();
    });
    child.stdout!.on('data', (data) => {
      output += data.toString();
      const lines = output.split('\n');
      output = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('{')) continue;
        const event = JSON.parse(line) as { event: string; httpUrl: string };
        if (event.event === 'relay.started') {
          clearTimeout(timer);
          resolveReady(event);
        }
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code) reject(new Error(errors));
    });
  });
  return { child, ready };
};

const stop = async (child: ChildProcess) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const stopped = once(child, 'exit');
  child.kill('SIGTERM');
  await stopped;
};

it.each([false, true])(
  'loads stock-only or simultaneous stock/fork catalogs from additive CLI flags (fork=%s)',
  async (withFork) => {
    const root = await mkdtemp(join(tmpdir(), 'agent-teams-catalog-cli-'));
    const template = join(root, 'template.sh'),
      bundle = join(root, 'bundle.tgz');
    await writeFile(template, 'RUNTIME_KIND="__RUNTIME_KIND__"\n__PAYLOAD_BELOW__\n');
    await writeFile(bundle, 'worker-only-fixture');
    const args = [
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--data-dir',
      join(root, 'relay'),
      '--public-url',
      'https://relay.example',
      '--join-stock-installer-template',
      template,
      '--join-stock-worker-bundle-platform',
      'darwin-arm64=' + bundle,
    ];
    if (withFork)
      args.push(
        '--join-installer-template',
        template,
        '--join-worker-bundle-platform',
        'linux-x64=' + bundle
      );
    const { child, ready } = start(args);
    try {
      const started = await ready;
      const catalog = await (await fetch(started.httpUrl + '/join/api/teams')).json();
      expect(catalog.installerRuntimes.map((runtime: { id: string }) => runtime.id)).toEqual(
        withFork ? ['fork', 'stock'] : ['stock']
      );
      expect(catalog.installerPlatforms.map((platform: { id: string }) => platform.id)).toEqual(
        withFork ? ['linux-x64'] : []
      );
      expect(catalog.installerAvailable).toBe(withFork);
    } finally {
      await stop(child);
      await rm(root, { recursive: true, force: true });
    }
  },
  15000
);
