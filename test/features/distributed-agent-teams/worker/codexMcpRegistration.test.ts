import { execFile } from 'node:child_process';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  inspectCodexMcpRegistration,
  installCodexMcpRegistration,
  removeCodexMcpRegistration,
} from '@claude-teams/agent-teams-worker';

import { writeCodexConfigAtomically } from '../../../../packages/agent-teams-worker/src/codexConfigTransaction';
import { controlMcpServerNameForInstallation } from '../../../../packages/agent-teams-worker/src/codexMcpServerNames';

describe('Codex MCP registration', () => {
  it('serializes registrations from independent installer processes', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'agent-teams-codex-processes-'));
    const configPath = join(testDir, 'config.toml');
    const runnerPath = join(testDir, 'register.mts');
    await writeFile(
      `${configPath}.agent-teams.lock`,
      JSON.stringify({ pid: 2147483647, token: 'test-owned-abandoned-process-lock' })
    );
    await writeFile(
      runnerPath,
      [
        `import { installCodexMcpRegistration } from ${JSON.stringify(resolve('packages/agent-teams-worker/src/codexMcpRegistration.ts'))};`,
        'await installCodexMcpRegistration(process.argv[2], { serverName: process.argv[3], command: "node", args: ["--socket", process.argv[4]] });',
      ].join('\n')
    );
    const names = ['fork-process', 'stock-process', 'another-process', 'fourth-process'].map(
      controlMcpServerNameForInstallation
    );
    await Promise.all(
      names.map((name) =>
        promisify(execFile)(
          process.execPath,
          ['--import', 'tsx', runnerPath, configPath, name, `/tmp/${name}.sock`],
          { timeout: 10000 }
        )
      )
    );
    const content = await readFile(configPath, 'utf8');
    for (const name of names)
      expect(inspectCodexMcpRegistration(content, name).status).toBe('managed');
  });

  it('recovers a config lock left by an exited installer', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'agent-teams-codex-stale-lock-'));
    const configPath = join(testDir, 'config.toml');
    await writeFile(
      `${configPath}.agent-teams.lock`,
      JSON.stringify({ pid: 2147483647, token: 'test-owned-abandoned-lock' })
    );
    expect(
      (
        await installCodexMcpRegistration(configPath, {
          command: 'node',
          args: [],
          serverName: controlMcpServerNameForInstallation('stock'),
        })
      ).changed
    ).toBe(true);
  });

  it('preserves external changes when an installer attempts to commit stale configuration', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'agent-teams-codex-external-'));
    const configPath = join(testDir, 'config.toml');
    await writeFile(configPath, 'model = "external-editor"\n');
    await expect(
      writeCodexConfigAtomically(configPath, 'model = "before"\n', 'model = "installer"\n')
    ).rejects.toThrow('changed outside this installer');
    expect(await readFile(configPath, 'utf8')).toBe('model = "external-editor"\n');
    expect(
      (
        await installCodexMcpRegistration(configPath, {
          command: 'node',
          args: [],
          serverName: controlMcpServerNameForInstallation('stock'),
        })
      ).changed
    ).toBe(true);
  });

  it('serializes concurrent installations and removes only the selected installation', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'agent-teams-codex-concurrent-'));
    const configPath = join(testDir, 'config.toml');
    const unrelated = 'model = "personal-model"\n';
    await writeFile(configPath, unrelated);
    const specs = ['fork', 'stock', 'another'].map((id) => ({
      serverName: controlMcpServerNameForInstallation(id),
      command: '/opt/node',
      args: ['/opt/worker/controlMcpCli.js', '--socket', `/tmp/${id}.sock`],
    }));
    const installed = await Promise.all(
      specs.map((spec) => installCodexMcpRegistration(configPath, spec))
    );
    expect(installed.every(({ changed }) => changed)).toBe(true);
    const content = await readFile(configPath, 'utf8');
    for (const spec of specs)
      expect(inspectCodexMcpRegistration(content, spec.serverName).status).toBe('managed');
    expect(content).toContain(unrelated);
    expect(inspectCodexMcpRegistration(content).status).toBe('absent');

    const removed = await removeCodexMcpRegistration(configPath, specs[1].serverName, specs[1]);
    expect(removed.changed).toBe(true);
    const remaining = await readFile(configPath, 'utf8');
    expect(inspectCodexMcpRegistration(remaining, specs[0].serverName).status).toBe('managed');
    expect(inspectCodexMcpRegistration(remaining, specs[1].serverName).status).toBe('absent');
    expect(inspectCodexMcpRegistration(remaining, specs[2].serverName).status).toBe('managed');
    expect(remaining).toContain(unrelated);
  });

  it('refuses replacing or removing a named registration with a mismatched target', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'agent-teams-codex-target-'));
    const configPath = join(testDir, 'config.toml');
    const spec = {
      serverName: controlMcpServerNameForInstallation('stock'),
      command: 'node',
      args: ['control.js', '--socket', '/tmp/stock.sock'],
    };
    await installCodexMcpRegistration(configPath, spec);
    const original = await readFile(configPath, 'utf8');
    const other = { ...spec, args: ['control.js', '--socket', '/tmp/fork.sock'] };
    expect(await installCodexMcpRegistration(configPath, other)).toMatchObject({
      changed: false,
      state: { status: 'conflict', reason: 'managed_target_mismatch' },
    });
    expect(await removeCodexMcpRegistration(configPath, spec.serverName, other)).toMatchObject({
      changed: false,
      state: { status: 'conflict', reason: 'managed_target_mismatch' },
    });
    expect(await readFile(configPath, 'utf8')).toBe(original);
  });

  it('validates names and does not confuse an installation name with its longer sibling', async () => {
    expect(() => controlMcpServerNameForInstallation('../other')).toThrow('Invalid');
    expect(() => inspectCodexMcpRegistration('', 'other-server')).toThrow('Invalid');
    const testDir = await mkdtemp(join(tmpdir(), 'agent-teams-codex-prefix-'));
    const configPath = join(testDir, 'config.toml');
    const name = controlMcpServerNameForInstallation('stock');
    const longer = controlMcpServerNameForInstallation('stock2');
    await installCodexMcpRegistration(configPath, {
      serverName: longer,
      command: 'node',
      args: [],
    });
    const content = await readFile(configPath, 'utf8');
    expect(inspectCodexMcpRegistration(content, name).status).toBe('absent');
    expect(inspectCodexMcpRegistration(content, longer).status).toBe('managed');
    expect(await removeCodexMcpRegistration(configPath, name)).toMatchObject({ changed: false });
    expect(await readFile(configPath, 'utf8')).toBe(content);
  });

  it('refuses to remove extra tables smuggled inside its ownership markers', () => {
    expect(
      inspectCodexMcpRegistration(
        [
          '# >>> agent-teams-worker managed: agent-teams-control',
          '[mcp_servers.agent-teams-control]',
          'command = "node"',
          'args = []',
          '[mcp_servers.other]',
          'command = "keep-me"',
          '# <<< agent-teams-worker managed: agent-teams-control',
        ].join('\n')
      )
    ).toMatchObject({ status: 'invalid', reason: 'invalid_managed_block' });
  });

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
    const existing = ['[mcp_servers.agent-teams-control]', 'command = "something-else"', ''].join(
      '\n'
    );
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
