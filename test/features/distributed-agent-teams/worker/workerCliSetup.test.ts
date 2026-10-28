import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { writeRuntimeInstallation } from '../../../../packages/agent-teams-worker/src/runtimeInstallation';

const execFileAsync = promisify(execFile);

const runWorkerCli = async (args: readonly string[]): Promise<string> => {
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = await execFileAsync(
    pnpm,
    ['exec', 'tsx', 'packages/agent-teams-worker/src/cli.ts', ...args],
    { cwd: process.cwd(), timeout: 15_000 }
  );
  return result.stdout;
};

describe('agent-teams-worker setup CLI', () => {
  it('requires an explicit shared socket for connect-only and reports its configuration', async () => {
    await expect(runWorkerCli(['status', '--app-server-connect-only'])).rejects.toThrow(
      /requires shared-daemon mode and --app-server-socket/
    );
    await expect(
      runWorkerCli(['status', '--app-server-mode', 'shared-daemon', '--app-server-connect-only'])
    ).rejects.toThrow(/requires shared-daemon mode and --app-server-socket/);
    const testDir = await mkdtemp(join(tmpdir(), 'agent-teams-fork-cli-'));
    const status = JSON.parse(
      await runWorkerCli([
        'status',
        '--data-dir',
        testDir,
        '--codex-config',
        join(testDir, 'config.toml'),
        '--app-server-mode',
        'shared-daemon',
        '--app-server-connect-only',
        '--app-server-socket',
        join(testDir, 'fork.sock'),
      ])
    );
    expect(status.appServer).toEqual({
      mode: 'shared-daemon',
      connectOnly: true,
      socketPath: join(testDir, 'fork.sock'),
    });
  });

  it('registers, reports, and removes only the owned Codex MCP entry', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'agent-teams-worker-cli-'));
    const dataDir = join(testDir, 'worker');
    const configPath = join(testDir, 'codex', 'config.toml');
    const socketPath = join(dataDir, 'control.sock');

    const setupOutput = JSON.parse(
      await runWorkerCli([
        'setup',
        '--data-dir',
        dataDir,
        '--codex-config',
        configPath,
        '--control-socket',
        socketPath,
        '--bridge-command',
        process.execPath,
        '--bridge-arg',
        '/opt/agent-teams/controlMcpCli.js',
        '--bridge-arg',
        '--socket',
        '--bridge-arg',
        socketPath,
      ])
    ) as { changed: boolean; state: { status: string } };
    expect(setupOutput).toMatchObject({ changed: true, state: { status: 'managed' } });
    expect(await readFile(configPath, 'utf8')).toContain('/opt/agent-teams/controlMcpCli.js');

    const statusOutput = JSON.parse(
      await runWorkerCli([
        'status',
        '--data-dir',
        dataDir,
        '--codex-config',
        configPath,
        '--control-socket',
        socketPath,
      ])
    ) as { codexHome: string; codexMcp: { state: { status: string } } };
    expect(statusOutput.codexHome).toBe(join(dataDir, 'codex-home'));
    expect(statusOutput.codexMcp.state.status).toBe('managed');

    const removeOutput = JSON.parse(
      await runWorkerCli(['mcp-remove', '--codex-config', configPath])
    ) as { changed: boolean; state: { status: string } };
    expect(removeOutput).toMatchObject({ changed: true, state: { status: 'absent' } });
    expect(await readFile(configPath, 'utf8')).not.toContain('agent-teams-control');
  });

  it('can manage two installation registrations in one Codex config independently', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'agent-teams-multiple-cli-'));
    const configPath = join(testDir, 'config.toml');
    const first = 'agent_teams_control_stock';
    const second = 'agent_teams_control_fork';
    const common = ['--codex-config', configPath, '--bridge-command', process.execPath];
    await runWorkerCli([
      'setup',
      ...common,
      '--control-mcp-name',
      first,
      '--control-socket',
      join(testDir, 'first.sock'),
    ]);
    await runWorkerCli([
      'setup',
      ...common,
      '--control-mcp-name',
      second,
      '--control-socket',
      join(testDir, 'second.sock'),
    ]);
    expect(await readFile(configPath, 'utf8')).toContain(first);
    expect(await readFile(configPath, 'utf8')).toContain(second);
    const status = JSON.parse(
      await runWorkerCli(['status', '--codex-config', configPath, '--control-mcp-name', second])
    );
    expect(status.codexMcp.state.status).toBe('managed');
    await runWorkerCli(['mcp-remove', '--codex-config', configPath, '--control-mcp-name', first]);
    expect(await readFile(configPath, 'utf8')).not.toContain(first);
    expect(await readFile(configPath, 'utf8')).toContain(second);
  });

  it('uses saved installation home and refuses successful removal after its target was replaced', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'agt-cli-owned-'));
    const home = join(dataDir, 'selected-home');
    await mkdir(home, { mode: 0o700 });
    const name = 'agent_teams_control_cli';
    await writeRuntimeInstallation(dataDir, {
      schemaVersion: 1,
      installationId: randomUUID(),
      runtimeKind: 'stock',
      serverOwnership: 'external',
      appServerMode: 'shared-daemon',
      endpoint: join(dataDir, 'app.sock'),
      codexHome: home,
      binaryPath: '/test/codex',
      resolvedBinaryPath: '/test/codex',
      binaryVersion: '0.164.0',
      controlMcpName: name,
      messageDeliveryMode: 'mcp-inbox',
      checkedAt: new Date().toISOString(),
      checks: [],
    });
    await runWorkerCli(['setup', '--data-dir', dataDir]);
    const status = JSON.parse(await runWorkerCli(['status', '--data-dir', dataDir]));
    expect(status.codexHome).toBe(home);
    expect(status.codexMcp.configPath).toBe(join(home, 'config.toml'));
    expect(status.runtimeInstallation.controlMcpTarget.command).toBeTruthy();
    const path = join(home, 'config.toml');
    const contents = await readFile(path, 'utf8');
    await writeFile(path, contents.replace(/^command = .+$/m, 'command = "/test/replaced-target"'));
    await expect(runWorkerCli(['mcp-remove', '--data-dir', dataDir])).rejects.toMatchObject({
      code: 2,
    });
    expect(await readFile(path, 'utf8')).toContain('/test/replaced-target');
  });
});
