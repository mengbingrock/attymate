import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  inspectCodexMcpRegistration,
  installCodexMcpRegistration,
  removeCodexMcpRegistration,
} from '@claude-teams/agent-teams-worker';

describe('Codex MCP registration', () => {
  it('installs, updates, and removes only its owned server block', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'agent-teams-codex-config-'));
    const configPath = join(testDir, 'config.toml');
    const unrelated = [
      'model = "gpt-5.6-sol"',
      '',
      '[mcp_servers.existing]',
      'command = "existing-tool"',
      'args = ["--keep-me"]',
      '',
    ].join('\n');
    await writeFile(configPath, unrelated, 'utf8');

    const initial = await installCodexMcpRegistration(configPath, {
      command: '/opt/agent-teams/bin/agent-teams-worker',
      args: ['control-mcp', '--socket', '/tmp/agent-teams/control.sock'],
    });
    expect(initial.changed).toBe(true);
    const installed = await readFile(configPath, 'utf8');
    expect(installed).toContain(unrelated);
    expect(installed).toContain('[mcp_servers.agent-teams-control]');
    expect(installed).toContain('enabled_tools = ["agent_context", "worker_status"');

    const repeated = await installCodexMcpRegistration(configPath, {
      command: '/opt/agent-teams/bin/agent-teams-worker',
      args: ['control-mcp', '--socket', '/tmp/agent-teams/control.sock'],
    });
    expect(repeated.changed).toBe(false);

    const updated = await installCodexMcpRegistration(configPath, {
      command: '/opt/agent-teams/bin/agent-teams-worker',
      args: ['control-mcp', '--socket', '/tmp/agent-teams/new-control.sock'],
    });
    expect(updated.changed).toBe(true);
    const updatedContent = await readFile(configPath, 'utf8');
    expect(updatedContent).toContain('/tmp/agent-teams/new-control.sock');
    expect(updatedContent.match(/\[mcp_servers\.agent-teams-control\]/g)).toHaveLength(1);
    expect(updatedContent).toContain(unrelated);

    const removed = await removeCodexMcpRegistration(configPath);
    expect(removed.changed).toBe(true);
    expect(await readFile(configPath, 'utf8')).toContain(unrelated);
    expect(await readFile(configPath, 'utf8')).not.toContain('agent-teams-control');
  });

  it('does not overwrite an unmanaged server with the same name', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'agent-teams-codex-conflict-'));
    const configPath = join(testDir, 'config.toml');
    const existing = [
      '[mcp_servers.agent-teams-control]',
      'command = "something-else"',
      '',
    ].join('\n');
    await writeFile(configPath, existing, 'utf8');

    const result = await installCodexMcpRegistration(configPath, {
      command: 'agent-teams-worker',
      args: ['control-mcp'],
    });
    expect(result).toMatchObject({ changed: false, state: { status: 'conflict' } });
    expect(await readFile(configPath, 'utf8')).toBe(existing);
  });

  it('rejects unbalanced ownership markers and symlinked config files', async () => {
    expect(
      inspectCodexMcpRegistration(
        '# >>> agent-teams-worker managed: agent-teams-control\n[mcp_servers.other]\n'
      )
    ).toEqual({ status: 'invalid', reason: 'unbalanced_managed_markers' });

    if (process.platform === 'win32') return;
    const testDir = await mkdtemp(join(tmpdir(), 'agent-teams-codex-symlink-'));
    const targetPath = join(testDir, 'target.toml');
    const configPath = join(testDir, 'config.toml');
    await writeFile(targetPath, '', 'utf8');
    await symlink(targetPath, configPath);

    await expect(
      installCodexMcpRegistration(configPath, {
        command: 'agent-teams-worker',
        args: ['control-mcp'],
      })
    ).rejects.toThrow('Refusing to replace symlinked Codex config');
  });
});
