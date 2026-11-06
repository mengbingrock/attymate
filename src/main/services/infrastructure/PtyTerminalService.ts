/**
 * PtyTerminalService — manages node-pty terminal instances.
 *
 * Provides PTY spawning, IO, and lifecycle management for the embedded terminal.
 * Events (data, exit) are forwarded to the renderer via mainWindow.webContents.send().
 */

import crypto from 'node:crypto';

import { getHomeDir } from '@main/utils/pathDecoder';
import { safeSendToRenderer } from '@main/utils/safeWebContentsSend';
// eslint-disable-next-line boundaries/element-types -- IPC channel constants shared between main and preload
import { TERMINAL_DATA, TERMINAL_EXIT } from '@preload/constants/ipcChannels';
import { createLogger } from '@shared/utils/logger';

import { buildProviderAwareCliEnv } from '../runtime/providerAwareCliEnv';

import { managedTerminalRegistry } from './ManagedTerminalRegistry';

import type { PtySpawnOptions } from '@shared/types/terminal';
import type { BrowserWindow } from 'electron';

const logger = createLogger('PtyTerminalService');

// Graceful import: node-pty is a native addon that may not be available
// if electron-rebuild was not run or native build tools are missing.
import type { IPty } from 'node-pty';
import type * as NodePty from 'node-pty';
type NodePtyModule = typeof NodePty;

let nodePty: NodePtyModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- node-pty is optional native addon
  nodePty = require('node-pty') as NodePtyModule;
} catch {
  logger.warn('node-pty not available — terminal features disabled');
}

export class PtyTerminalService {
  private ptys = new Map<string, IPty>();
  private readonly managedViews = new Map<string, { sessionId: string; detach: () => void }>();
  private mainWindow: BrowserWindow | null = null;

  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  /**
   * Spawn a new PTY process.
   * @returns Unique PTY ID for subsequent write/resize/kill calls.
   * @throws If node-pty native module is not available.
   */
  async spawn(options?: PtySpawnOptions): Promise<string> {
    if (options?.managedSessionId) {
      const terminal = managedTerminalRegistry.get(options.managedSessionId);
      if (!terminal) throw new Error('The agent terminal has exited');
      const id = crypto.randomUUID();
      const offData = terminal.onData((data) => this.send(TERMINAL_DATA, id, data));
      const offExit = terminal.onExit((exitCode) => {
        this.send(TERMINAL_EXIT, id, exitCode);
        this.kill(id);
      });
      this.managedViews.set(id, {
        sessionId: options.managedSessionId,
        detach: () => {
          offData();
          offExit();
        },
      });
      return id;
    }
    if (!nodePty) {
      throw new Error(
        'Terminal not available: node-pty native module not found. Run: pnpm install'
      );
    }

    const id = crypto.randomUUID();
    const { env } = await buildProviderAwareCliEnv({
      env: options?.env,
      connectionMode: 'augment',
      allowStoredApiKeyDecryption: false,
    });
    const shell =
      options?.command ??
      (process.platform === 'win32'
        ? (env.COMSPEC ?? process.env.COMSPEC ?? 'powershell.exe')
        : (env.SHELL ?? process.env.SHELL ?? '/bin/bash'));

    const home = getHomeDir();
    const pty = nodePty.spawn(shell, options?.args ?? [], {
      name: 'xterm-256color',
      cols: options?.cols ?? 80,
      rows: options?.rows ?? 24,
      cwd: options?.cwd ?? home,
      env: env as Record<string, string>,
    });

    pty.onData((data) => this.send(TERMINAL_DATA, id, data));
    pty.onExit(({ exitCode }) => {
      this.send(TERMINAL_EXIT, id, exitCode);
      this.ptys.delete(id);
    });

    this.ptys.set(id, pty);
    logger.info(`PTY spawned: ${id} (${shell})`);
    return id;
  }

  write(id: string, data: string): void {
    const view = this.managedViews.get(id);
    if (view) {
      managedTerminalRegistry.get(view.sessionId)?.write(data);
      return;
    }
    this.ptys.get(id)?.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const view = this.managedViews.get(id);
    if (view) {
      const terminal = managedTerminalRegistry.get(view.sessionId);
      terminal?.resize(cols, rows);
      void terminal
        ?.snapshot()
        .then((data) => {
          if (this.managedViews.has(id)) this.send(TERMINAL_DATA, id, data);
        })
        .catch(() => undefined);
      return;
    }
    this.ptys.get(id)?.resize(cols, rows);
  }

  kill(id: string): void {
    const view = this.managedViews.get(id);
    if (view) {
      view.detach();
      this.managedViews.delete(id);
      return;
    }
    const pty = this.ptys.get(id);
    if (pty) {
      pty.kill();
      this.ptys.delete(id);
      logger.info(`PTY killed: ${id}`);
    }
  }

  /** Kill all PTY processes. Called on app shutdown. */
  killAll(): void {
    for (const id of this.managedViews.keys()) this.kill(id);
    managedTerminalRegistry.killAll();
    const count = this.ptys.size;
    if (count > 0) {
      logger.info(`Killing ${count} PTY processes on shutdown`);
    }
    this.ptys.forEach((pty) => pty.kill());
    this.ptys.clear();
  }

  private send(channel: string, ...args: unknown[]): void {
    safeSendToRenderer(this.mainWindow, channel, ...args);
  }
}
