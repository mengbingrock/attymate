import { parseRuntimeProcessTable } from '@features/tmux-installer/main';
import { TmuxPlatformCommandExecutor } from '@features/tmux-installer/main/infrastructure/runtime/TmuxPlatformCommandExecutor';
import { describe, expect, it, vi } from 'vitest';

describe('parseRuntimeProcessTable', () => {
  it('parses pid, ppid and command rows', () => {
    expect(
      parseRuntimeProcessTable('  10   1 /bin/zsh\n  11  10 node runtime --team-name demo')
    ).toEqual([
      { pid: 10, ppid: 1, command: '/bin/zsh' },
      { pid: 11, ppid: 10, command: 'node runtime --team-name demo' },
    ]);
  });

  it('parses optional cpu and rss columns', () => {
    expect(
      parseRuntimeProcessTable('  10   1  3.5  120000 /bin/zsh\n  11  10  0.1  42 node demo')
    ).toEqual([
      { pid: 10, ppid: 1, command: '/bin/zsh', cpuPercent: 3.5, rssBytes: 122_880_000 },
      { pid: 11, ppid: 10, command: 'node demo', cpuPercent: 0.1, rssBytes: 43_008 },
    ]);
  });

  it('skips malformed rows', () => {
    expect(parseRuntimeProcessTable('bad\n  0  1 nope\n  12  0 /bin/node')).toEqual([
      { pid: 12, ppid: 0, command: '/bin/node' },
    ]);
  });
});

describe('TmuxPlatformCommandExecutor.newDetachedSession', () => {
  it('arms the pane breakout hook before starting an interactive Claude lead', async () => {
    const executor = new TmuxPlatformCommandExecutor();
    const commands: string[][] = [];
    vi.spyOn(executor, 'execTmux').mockImplementation(async (args) => {
      commands.push(args);
      return {
        exitCode: 0,
        stdout: args[0] === 'new-session' ? '%42\n' : '',
        stderr: '',
      };
    });

    await executor.newDetachedSession({
      sessionName: 'agteams-large-roster-test',
      cwd: '/tmp/project',
      command: '/tmp/launch.sh',
      breakoutNewPanes: true,
    });

    expect(commands.map(([command]) => command)).toEqual([
      'new-session',
      'set-option',
      'set-hook',
      'respawn-pane',
    ]);
    expect(commands[0]).toContain('#{pane_id}');
    expect(commands[0]).not.toContain('/tmp/launch.sh');
    expect(commands[2]).toEqual([
      'set-hook',
      '-t',
      '%42',
      'after-split-window',
      'break-pane -d',
    ]);
    expect(commands[3]).toEqual([
      'respawn-pane',
      '-k',
      '-t',
      '%42',
      '/tmp/launch.sh',
    ]);
  });

  it('keeps the direct launch path for sessions that manage their own layout', async () => {
    const executor = new TmuxPlatformCommandExecutor();
    const commands: string[][] = [];
    vi.spyOn(executor, 'execTmux').mockImplementation(async (args) => {
      commands.push(args);
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    await executor.newDetachedSession({
      sessionName: 'agteams-codex-lanes-test',
      cwd: '/tmp/project',
      command: '/tmp/launch.sh',
    });

    expect(commands.map(([command]) => command)).toEqual(['new-session', 'set-option']);
    expect(commands[0]).toContain('/tmp/launch.sh');
  });

  it('removes the dormant session when the pane breakout hook cannot be armed', async () => {
    const executor = new TmuxPlatformCommandExecutor();
    const commands: string[][] = [];
    vi.spyOn(executor, 'execTmux').mockImplementation(async (args) => {
      commands.push(args);
      if (args[0] === 'new-session') {
        return { exitCode: 0, stdout: '%7\n', stderr: '' };
      }
      if (args[0] === 'set-hook') {
        return { exitCode: 1, stdout: '', stderr: 'hook rejected' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    await expect(
      executor.newDetachedSession({
        sessionName: 'agteams-hook-failure-test',
        cwd: '/tmp/project',
        command: '/tmp/launch.sh',
        breakoutNewPanes: true,
      })
    ).rejects.toThrow('hook rejected');

    expect(commands.at(-1)).toEqual([
      'kill-session',
      '-t',
      '=agteams-hook-failure-test',
    ]);
    expect(commands.some(([command]) => command === 'respawn-pane')).toBe(false);
  });
});
