import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

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
});
