import { randomUUID } from 'node:crypto';

import { managedTerminalRegistry } from '@main/services/infrastructure/ManagedTerminalRegistry';
import { execCli, resolveDirectWindowsLauncher } from '@main/utils/childProcess';
import { Terminal } from '@xterm/headless';

import { isPaneSafeLauncherEnvKey } from './launcherEnv';

import type { RuntimeLaneBinding } from '../core/domain/runtimeBinding';
import type { CodexLanesLaunchInput } from './CodexTeamLanesService';
import type { IPty } from 'node-pty';

interface NativeLane {
  binding: RuntimeLaneBinding;
  pty: IPty;
  terminal: Terminal;
  alive: boolean;
  pendingWrites: Promise<void>;
  pendingInput: Promise<void>;
}

/** Native ConPTY sessions; no shell launcher, tmux, or Claude executable. */
export class NativeCodexLanes {
  private readonly sessions = new Map<string, Map<string, NativeLane>>();

  async launch(sessionName: string, input: CodexLanesLaunchInput): Promise<RuntimeLaneBinding[]> {
    const { spawn } = await import('node-pty');
    // Recent bundled CLIs can launch without their optional background daemon.
    // Probe the flag instead of imposing it on older stock Codex installations.
    const standaloneArgs = await execCli(input.codexPath, ['--no-daemon', '--version'], {
      env: input.env,
      timeout: 8000,
      windowsHide: true,
    })
      .then(() => ['--no-daemon'])
      .catch(() => []);
    if (this.sessions.has(sessionName))
      throw new Error('Codex sessions already exist for this run');
    const lanes = new Map<string, NativeLane>();
    this.sessions.set(sessionName, lanes);
    try {
      for (const [index, spec] of input.lanes.entries()) {
        const paneId = `codex-pty-${randomUUID()}`;
        const terminal = new Terminal({
          cols: 120,
          rows: 40,
          scrollback: 2000,
          allowProposedApi: true,
        });
        const env = Object.fromEntries(
          Object.entries(input.env).filter(
            (entry): entry is [string, string] =>
              typeof entry[1] === 'string' && isPaneSafeLauncherEnvKey(entry[0])
          )
        );
        delete env.ELECTRON_RUN_AS_NODE;
        const launcher = resolveDirectWindowsLauncher(input.codexPath);
        const pty = spawn(
          launcher?.command ?? input.codexPath,
          [
            ...(launcher?.argsPrefix ?? []),
            ...standaloneArgs,
            '--no-alt-screen',
            '-C',
            input.cwd,
            ...spec.args,
          ],
          {
            cwd: input.cwd,
            env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
            name: 'xterm-256color',
            cols: 120,
            rows: 40,
          }
        );
        const binding: RuntimeLaneBinding = {
          memberName: spec.memberName,
          isLead: spec.isLead,
          paneId,
          windowIndex: index,
          pid: pty.pid,
        };
        const lane: NativeLane = {
          binding,
          pty,
          terminal,
          alive: true,
          pendingWrites: Promise.resolve(),
          pendingInput: Promise.resolve(),
        };
        lanes.set(paneId, lane);
        const dataListeners = new Set<(data: string) => void>();
        const exitListeners = new Set<(code: number) => void>();
        // Answer cursor-position / terminal capability probes from the Codex TUI.
        terminal.onData((data) => {
          if (lane.alive) pty.write(data);
        });
        pty.onData((data) => {
          if (!lane.alive) return;
          lane.pendingWrites = lane.pendingWrites.then(
            () =>
              new Promise<void>((resolve) => {
                terminal.write(data, resolve);
              })
          );
          for (const listener of dataListeners) listener(data);
        });
        pty.onExit(({ exitCode }) => {
          const unexpectedExit = lane.alive;
          lane.alive = false;
          managedTerminalRegistry.unregister(paneId);
          for (const listener of exitListeners) listener(exitCode);
          if (unexpectedExit) {
            this.stop(sessionName);
            input.callbacks.onFailed(
              `Codex lane "${spec.memberName}" exited with code ${exitCode}`
            );
          }
        });
        managedTerminalRegistry.register(paneId, {
          write: (data) => {
            if (lane.alive) pty.write(data);
          },
          resize: (cols, rows) => {
            if (!lane.alive) return;
            terminal.resize(cols, rows);
            pty.resize(cols, rows);
          },
          snapshot: async () => {
            await lane.pendingWrites;
            const buffer = terminal.buffer.active;
            const lines = Array.from(
              { length: terminal.rows },
              (_, row) => buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? ''
            );
            return `\x1b[2J\x1b[H${lines.join('\r\n')}\x1b[${buffer.cursorY + 1};${buffer.cursorX + 1}H`;
          },
          onData: (listener) => {
            dataListeners.add(listener);
            return () => dataListeners.delete(listener);
          },
          onExit: (listener) => {
            exitListeners.add(listener);
            return () => exitListeners.delete(listener);
          },
          kill: () => this.killLane(lane),
        });
      }
      return [...lanes.values()].map((lane) => lane.binding);
    } catch (error) {
      this.stop(sessionName);
      throw error;
    }
  }

  hasSession(sessionName: string): boolean {
    const lanes = this.sessions.get(sessionName);
    return Boolean(lanes?.size && [...lanes.values()].every((lane) => lane.alive));
  }

  listLanes(sessionName: string): RuntimeLaneBinding[] {
    return [...(this.sessions.get(sessionName)?.values() ?? [])]
      .filter((lane) => lane.alive)
      .map((lane) => lane.binding);
  }

  private find(paneId: string): NativeLane {
    for (const session of this.sessions.values()) {
      const lane = session.get(paneId);
      if (lane?.alive) return lane;
    }
    throw new Error('Codex terminal session has exited');
  }

  async capturePaneTail(paneId: string, count: number): Promise<string> {
    const lane = this.find(paneId);
    await lane.pendingWrites;
    const buffer = lane.terminal.buffer.active;
    // ConPTY screens can have unused rows below the composer. Tail the content,
    // otherwise short captures miss input waiting near the top of the viewport.
    let end = buffer.length;
    while (
      end > 0 &&
      !buffer
        .getLine(end - 1)
        ?.translateToString(true)
        .trim()
    )
      end -= 1;
    const lines: string[] = [];
    for (let row = Math.max(0, end - count); row < end; row += 1) {
      lines.push(buffer.getLine(row)?.translateToString(true) ?? '');
    }
    return lines.join('\n');
  }

  pressEnter(paneId: string): void {
    this.find(paneId).pty.write('\r');
  }

  async pasteTextIntoPane(paneId: string, text: string): Promise<void> {
    const lane = this.find(paneId);
    const delivery = lane.pendingInput.then(() => this.submitPaste(lane, paneId, text));
    lane.pendingInput = delivery.catch(() => undefined);
    return delivery;
  }

  private async submitPaste(lane: NativeLane, paneId: string, text: string): Promise<void> {
    if (!lane.alive) throw new Error('Codex terminal exited before accepting input');
    lane.pty.write(`\x1b[200~${text.replaceAll('\x1b', '')}\x1b[201~`);
    const firstLine =
      text
        .split('\n')
        .find((line) => line.trim())
        ?.trim()
        .slice(0, 48) ?? '';
    const isPending = async (): Promise<boolean> => {
      const lines = (await this.capturePaneTail(paneId, 40)).split('\n');
      const composer = lines.filter((line) => /^\s*›/.test(line)).at(-1) ?? '';
      return (
        /\[Pasted Content\b/i.test(composer) || Boolean(firstLine && composer.includes(firstLine))
      );
    };
    // Wait for Codex to render the paste before submitting. ConPTY can deliver
    // large pastes after a fixed-delay Enter, leaving the entire prompt unsent.
    let rendered = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (await isPending()) {
        rendered = true;
        break;
      }
    }
    if (!rendered)
      throw new Error('Codex did not display the pasted message; retry from the member console');
    if (!lane.alive) throw new Error('Codex terminal exited before accepting input');
    lane.pty.write('\r');
    // Codex coalesces large pastes; an early Enter can become part of the paste
    // instead of submitting it. Inspect only the current composer before retrying.
    for (let attempt = 0; attempt <= 3; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (!(await isPending())) return;
      if (attempt < 3) lane.pty.write('\r');
    }
    throw new Error('Codex did not accept the pasted message; open the member console and retry');
  }

  stop(sessionName: string): void {
    const lanes = this.sessions.get(sessionName);
    this.sessions.delete(sessionName);
    for (const lane of lanes?.values() ?? []) {
      this.killLane(lane);
      managedTerminalRegistry.unregister(lane.binding.paneId);
      void lane.pendingWrites.finally(() => lane.terminal.dispose());
    }
  }

  private killLane(lane: NativeLane): void {
    if (!lane.alive) return;
    lane.alive = false;
    try {
      lane.pty.kill();
    } catch {
      /* The owned process may already have exited. */
    }
  }
}

export const nativeCodexLanes = new NativeCodexLanes();
