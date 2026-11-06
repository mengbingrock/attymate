// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  execCli: vi.fn(),
  resolveDirectWindowsLauncher: vi.fn(),
}));
vi.mock('node-pty', () => ({ spawn: mocks.spawn }));
vi.mock('@main/utils/childProcess', () => ({
  execCli: mocks.execCli,
  resolveDirectWindowsLauncher: mocks.resolveDirectWindowsLauncher,
}));

import { NativeCodexLanes } from '@features/interactive-team-runtime/main/NativeCodexLanes';
import { managedTerminalRegistry } from '@main/services/infrastructure/ManagedTerminalRegistry';

function fakePty() {
  let dataListener = (_data: string): void => undefined;
  let exitListener = (_event: { exitCode: number }): void => undefined;
  return {
    pid: 1234,
    write: vi.fn((data: string) => {
      if (data.startsWith('\x1b[200~'))
        dataListener('\x1b[2J\x1b[H› [Pasted Content 5000 chars]\r\nmodel · project');
      if (data === '\r') dataListener('\x1b[2J\x1b[HWorking…\r\n›\r\nmodel · project');
    }),
    resize: vi.fn(),
    onData: (listener: typeof dataListener) => {
      dataListener = listener;
    },
    onExit: (listener: typeof exitListener) => {
      exitListener = listener;
    },
    emit: (data: string) => dataListener(data),
    exit: () => exitListener({ exitCode: 0 }),
    kill: vi.fn(() => exitListener({ exitCode: 0 })),
  };
}

const input = {
  teamName: 'disposable',
  runId: 'run-1',
  cwd: 'C:\\test project',
  codexPath: 'C:\\Codex\\codex.exe',
  env: { PATH: 'C:\\tools', TMUX: 'do-not-inherit', ELECTRON_RUN_AS_NODE: '1' },
  lanes: [
    { memberName: 'lead', isLead: true, args: ['-m', 'chosen-model'], briefingPrompt: 'Hello' },
  ],
  callbacks: { checkpoint: vi.fn(), onLaneReady: vi.fn(), onFailed: vi.fn() },
};

afterEach(() => {
  managedTerminalRegistry.killAll();
  vi.clearAllMocks();
});

describe('native Codex terminals', () => {
  it('runs the selected stock CLI directly and captures its current screen', async () => {
    const pty = fakePty();
    mocks.spawn.mockReturnValue(pty);
    mocks.execCli.mockResolvedValue({ stdout: 'codex 1', stderr: '' });
    const backend = new NativeCodexLanes();
    const [lane] = await backend.launch('session', input);
    expect(mocks.spawn).toHaveBeenCalledWith(
      input.codexPath,
      ['--no-daemon', '--no-alt-screen', '-C', input.cwd, '-m', 'chosen-model'],
      expect.objectContaining({
        cwd: input.cwd,
        env: { PATH: 'C:\\tools', TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      })
    );
    pty.emit('Old dialog\r\n\x1b[2J\x1b[HReady\r\n› Type a task\r\nmodel · project');
    expect(await backend.capturePaneTail(lane.paneId, 40)).toContain('› Type a task');
    expect(await backend.capturePaneTail(lane.paneId, 12)).toContain('› Type a task');
    expect(await backend.capturePaneTail(lane.paneId, 40)).not.toContain('Old dialog');
    await backend.pasteTextIntoPane(lane.paneId, 'A multiline\nprompt');
    expect(pty.write.mock.calls.slice(-2)).toEqual([
      ['\x1b[200~A multiline\nprompt\x1b[201~'],
      ['\r'],
    ]);
    expect(backend.hasSession('session')).toBe(true);
    expect(managedTerminalRegistry.get(lane.paneId)).toBeDefined();
    backend.stop('session');
    expect(pty.kill).toHaveBeenCalledOnce();
    expect(backend.hasSession('session')).toBe(false);
    expect(managedTerminalRegistry.get(lane.paneId)).toBeUndefined();
  });

  it('keeps older Codex versions compatible and detects exited members', async () => {
    const pty = fakePty();
    mocks.spawn.mockReturnValue(pty);
    mocks.execCli.mockRejectedValue(new Error('unknown flag --no-daemon'));
    const backend = new NativeCodexLanes();
    const [lane] = await backend.launch('older', input);
    expect(mocks.spawn.mock.calls[0][1]).not.toContain('--no-daemon');
    pty.exit();
    expect(backend.hasSession('older')).toBe(false);
    await expect(backend.pasteTextIntoPane(lane.paneId, 'Hello')).rejects.toThrow('exited');
    backend.stop('older');
  });

  it('serializes concurrent messages to the same member', async () => {
    const pty = fakePty();
    mocks.spawn.mockReturnValue(pty);
    mocks.execCli.mockResolvedValue({ stdout: '', stderr: '' });
    const backend = new NativeCodexLanes();
    const [lane] = await backend.launch('queued', input);
    await Promise.all([
      backend.pasteTextIntoPane(lane.paneId, 'first'),
      backend.pasteTextIntoPane(lane.paneId, 'second'),
    ]);
    expect(pty.write.mock.calls).toEqual([
      ['\x1b[200~first\x1b[201~'],
      ['\r'],
      ['\x1b[200~second\x1b[201~'],
      ['\r'],
    ]);
    backend.stop('queued');
  });

  it('retries submission when a large paste remains in the composer above empty rows', async () => {
    const pty = fakePty();
    mocks.spawn.mockReturnValue(pty);
    mocks.execCli.mockResolvedValue({ stdout: '', stderr: '' });
    const backend = new NativeCodexLanes();
    const [lane] = await backend.launch('paste-retry', input);
    let enters = 0;
    pty.write.mockImplementation((data: string) => {
      if (data.startsWith('\x1b[200~'))
        pty.emit('\x1b[2J\x1b[H› [Pasted Content 5000 chars]\r\nmodel · project');
      if (data === '\r' && ++enters === 2)
        pty.emit('\x1b[2J\x1b[HWorking…\r\n›\r\nmodel · project');
    });
    await backend.pasteTextIntoPane(lane.paneId, 'A large bootstrap prompt');
    expect(enters).toBe(2);
    backend.stop('paste-retry');
  });

  it('waits for delayed paste rendering before sending Enter', async () => {
    const pty = fakePty();
    mocks.spawn.mockReturnValue(pty);
    mocks.execCli.mockResolvedValue({ stdout: '', stderr: '' });
    const backend = new NativeCodexLanes();
    const [lane] = await backend.launch('delayed-paste', input);
    let rendered = false;
    pty.write.mockImplementation((data: string) => {
      if (data.startsWith('\x1b[200~'))
        setTimeout(() => {
          rendered = true;
          pty.emit('\x1b[2J\x1b[H› [Pasted Content 5000 chars]\r\nmodel · project');
        }, 600);
      if (data === '\r') {
        expect(rendered).toBe(true);
        pty.emit('\x1b[2J\x1b[HWorking…\r\n›\r\nmodel · project');
      }
    });
    await backend.pasteTextIntoPane(lane.paneId, 'A delayed bootstrap prompt');
    backend.stop('delayed-paste');
  });

  it('stops already-created lanes when a later process fails to spawn', async () => {
    const pty = fakePty();
    mocks.execCli.mockResolvedValue({ stdout: '', stderr: '' });
    mocks.spawn.mockReturnValueOnce(pty).mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });
    const backend = new NativeCodexLanes();
    await expect(
      backend.launch('failed', {
        ...input,
        lanes: [input.lanes[0], { ...input.lanes[0], memberName: 'second', isLead: false }],
      })
    ).rejects.toThrow('spawn failed');
    expect(pty.kill).toHaveBeenCalledOnce();
    expect(backend.hasSession('failed')).toBe(false);
  });
});
