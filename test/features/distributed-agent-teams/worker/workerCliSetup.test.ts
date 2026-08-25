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
