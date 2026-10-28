import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import readline from 'node:readline';
import { parse as parseToml } from 'smol-toml';
import WebSocket from 'ws';
import { localAppServerWebSocket } from './localAppServerWebSocket';

import {
  runtimeConnectionFeatures,
  type CodexRuntimeConnectionPolicy,
} from './codexRuntimeConnections';

export interface CodexAppServerNotification {
  readonly method: string;
  readonly params: unknown;
}

export interface CodexAppServerRequest {
  readonly id: number | string;
  readonly method: string;
  readonly params: unknown;
}

export interface CodexAppServerSessionClosed {
  readonly error: Error;
}

export interface WorkerCodexAppServerSession {
  /** Public initialize metadata, distinct from the locally selected executable. */
  readonly serverInfo?: { readonly userAgent?: string };
  readonly request: <T>(method: string, params?: unknown, timeoutMs?: number) => Promise<T>;
  readonly notify: (method: string, params?: unknown) => void;
  readonly onNotification: (
    listener: (notification: CodexAppServerNotification) => void
  ) => () => void;
  readonly onRequest: (listener: (request: CodexAppServerRequest) => void) => () => void;
  readonly respondToRequest: (id: number | string, result: unknown) => void;
  readonly onClose: (listener: (event: CodexAppServerSessionClosed) => void) => () => void;
  readonly close: () => Promise<void>;
}

export interface WorkerCodexAppServerSessionFactory {
  readonly open: () => Promise<WorkerCodexAppServerSession>;
}

/**
 * How the Worker reaches Codex App Server.
 *
 * - `private-stdio`: spawn a private `codex app-server` child per session on stdio pipes. Nothing
 *   else can attach to that process.
 * - `shared-daemon`: use the managed App Server daemon of the Worker's `CODEX_HOME`
 *   (`codex app-server daemon start`) over its Unix control socket. Threads then live in the
 *   daemon, so the owner can attach later with `CODEX_HOME=<home> codex agents` or
 *   `CODEX_HOME=<home> codex resume` and watch or continue the same threads.
 */
export const CODEX_APP_SERVER_MODES = ['private-stdio', 'shared-daemon'] as const;
export type CodexAppServerMode = (typeof CODEX_APP_SERVER_MODES)[number];

export const resolveCodexAppServerMode = (value: string | undefined): CodexAppServerMode => {
  const mode = value?.trim();
  if (mode === undefined || mode === '') return 'private-stdio';
  if ((CODEX_APP_SERVER_MODES as readonly string[]).includes(mode)) {
    return mode as CodexAppServerMode;
  }
  throw new Error(
    `Unsupported Codex App Server mode ${JSON.stringify(value)}; expected one of ${CODEX_APP_SERVER_MODES.join(', ')}`
  );
};

/** Where `codex app-server daemon start` publishes the control socket for a Codex home. */
export const defaultCodexDaemonSocketPath = (codexHome: string): string =>
  join(codexHome, 'app-server-control', 'app-server-control.sock');

const codexFeatureDisableArgs = (
  disableRemotePlugins: boolean | undefined,
  connections?: CodexRuntimeConnectionPolicy
): readonly string[] =>
  Object.entries(runtimeConnectionFeatures(connections)).flatMap(([name, enabled]) =>
    name === 'remote_plugin' && disableRemotePlugins === false && !enabled
      ? []
      : [enabled ? '--enable' : '--disable', name]
  );

export const buildCodexDaemonStartArgs = (options: {
  readonly launcherArgs?: readonly string[];
  readonly disableRemotePlugins?: boolean;
  readonly connections?: CodexRuntimeConnectionPolicy;
  readonly restart?: boolean;
}): readonly string[] => [
  ...(options.launcherArgs ?? []),
  ...codexFeatureDisableArgs(options.disableRemotePlugins, options.connections),
  'app-server',
  'daemon',
  options.restart === true ? 'restart' : 'start',
];

const FEATURES_BLOCK_START = '# >>> agent-teams-worker managed: features';
const FEATURES_BLOCK_END = '# <<< agent-teams-worker managed: features';

const requiredFeatureDisables = (
  disableRemotePlugins: boolean | undefined,
  connections?: CodexRuntimeConnectionPolicy
): Readonly<Record<string, boolean>> =>
  Object.fromEntries(
    Object.entries(runtimeConnectionFeatures(connections)).filter(
      ([name, enabled]) => name !== 'remote_plugin' || disableRemotePlugins !== false || enabled
    )
  );

/**
 * The managed daemon does not inherit `--disable` flags from `codex app-server daemon start`; it
 * reads `[features]` from the home's `config.toml` instead. The Worker owns its private home, so
 * it records the same disables there that `private-stdio` mode passes on the command line. Returns
 * whether the file changed, in which case a running daemon must be restarted to pick it up.
 */
export const ensureCodexHomeFeatureDisables = async (
  codexHome: string,
  options: {
    readonly disableRemotePlugins?: boolean;
    readonly connections?: CodexRuntimeConnectionPolicy;
  } = {}
): Promise<{ readonly configPath: string; readonly changed: boolean }> => {
  const configPath = join(codexHome, 'config.toml');
  const required = requiredFeatureDisables(options.disableRemotePlugins, options.connections);
  let existing = '';
  try {
    existing = await readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(existing) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Worker Codex home config is not valid TOML (${configPath}): ${errorMessage(error)}`
    );
  }
  const features = parsed.features;
  const featureTable =
    typeof features === 'object' && features !== null && !Array.isArray(features)
      ? (features as Record<string, unknown>)
      : undefined;
  if (
    featureTable !== undefined &&
    Object.entries(required).every(([name, value]) => featureTable[name] === value)
  ) {
    return { configPath, changed: false };
  }
  const managedBlock = [
    FEATURES_BLOCK_START,
    '[features]',
    ...Object.entries(required).map(([name, value]) => `${name} = ${String(value)}`),
    FEATURES_BLOCK_END,
    '',
  ].join('\n');
  const startIndex = existing.indexOf(FEATURES_BLOCK_START);
  const endIndex = existing.indexOf(FEATURES_BLOCK_END);
  let next: string;
  if (startIndex >= 0 && endIndex > startIndex) {
    next =
      existing.slice(0, startIndex) +
      managedBlock +
      existing.slice(endIndex + FEATURES_BLOCK_END.length).replace(/^\n/, '');
  } else if (featureTable !== undefined) {
    throw new Error(
      `Worker Codex home config already defines [features] with a different policy (${configPath}); set ${Object.entries(
        required
      )
        .map(([name, value]) => `${name} = ${String(value)}`)
        .join(', ')} there or remove the table.`
    );
  } else {
    next = `${existing.replace(/\s*$/, '')}${existing.trim().length > 0 ? '\n\n' : ''}${managedBlock}`;
  }
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await writeFile(configPath, next, { encoding: 'utf8', mode: 0o600 });
  return { configPath, changed: true };
};

interface CodexAppServerSessionOptions {
  readonly requestTimeoutMs?: number;
  readonly initializeTimeoutMs?: number;
  readonly onServerRequest?: (request: CodexAppServerRequest) => Promise<unknown>;
}

export interface CodexAppServerProcessFactoryOptions extends CodexAppServerSessionOptions {
  readonly connections?: CodexRuntimeConnectionPolicy;
  readonly binaryPath: string;
  readonly launcherArgs?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly disableRemotePlugins?: boolean;
}

export interface CodexAppServerDaemonFactoryOptions extends CodexAppServerSessionOptions {
  readonly connections?: CodexRuntimeConnectionPolicy;
  readonly binaryPath: string;
  /** The Worker's `CODEX_HOME`; the daemon and its control socket belong to this home. */
  readonly codexHome: string;
  readonly launcherArgs?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly disableRemotePlugins?: boolean;
  /** Explicit control socket; defaults to `<codexHome>/app-server-control/app-server-control.sock`. */
  readonly socketPath?: string;
  /** Run `codex app-server daemon start` before connecting (idempotent). Default `true`. */
  readonly ensureDaemon?: boolean;
  /** Also persist the feature disables into the home's config.toml (restarting the daemon). */
  readonly writeHomeFeatureDisables?: boolean;
  readonly daemonStartTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  /** Test hook: supply a connectable socket path instead of starting or discovering a daemon. */
  readonly resolveSocketPath?: () => Promise<string>;
}

interface JsonRpcMessage {
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string; readonly data?: unknown };
}

interface PendingRequest {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: NodeJS.Timeout;
}

/** Minimal line-oriented duplex transport underneath a JSON-RPC session. */
interface JsonRpcTransport {
  readonly writable: () => boolean;
  readonly write: (line: string) => void;
  readonly onLine: (listener: (line: string) => void) => void;
  /** Fired when the peer goes away without `close()` having been called. */
  readonly onUnexpectedClose: (listener: (error: Error) => void) => void;
  readonly close: () => Promise<void>;
}

export class CodexAppServerRequestError extends Error {
  constructor(
    readonly method: string,
    readonly code: number | undefined,
    readonly data: unknown,
    message: string
  ) {
    super(message);
    this.name = 'CodexAppServerRequestError';
  }
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const INITIALIZE_PARAMS = {
  clientInfo: {
    name: 'agent_teams_worker',
    title: 'Agent Teams Worker',
    version: '0.1.0',
  },
  capabilities: {
    experimentalApi: false,
    optOutNotificationMethods: ['item/agentReasoning/delta'],
  },
} as const;

const initializeSession = async (
  session: WorkerCodexAppServerSession,
  timeoutMs: number
): Promise<WorkerCodexAppServerSession> => {
  try {
    const initialized = await session.request<{ userAgent?: unknown }>(
      'initialize',
      INITIALIZE_PARAMS,
      timeoutMs
    );
    session.notify('initialized', {});
    return {
      ...session,
      serverInfo:
        typeof initialized?.userAgent === 'string' ? { userAgent: initialized.userAgent } : {},
    };
  } catch (error) {
    await session.close();
    throw error;
  }
};

const createJsonRpcSession = (
  transport: JsonRpcTransport,
  options: CodexAppServerSessionOptions
): WorkerCodexAppServerSession => {
  const pending = new Map<number, PendingRequest>();
  const listeners = new Set<(notification: CodexAppServerNotification) => void>();
  const requestListeners = new Set<(request: CodexAppServerRequest) => void>();
  const pendingServerRequests = new Map<number | string, CodexAppServerRequest>();
  const closeListeners = new Set<(event: CodexAppServerSessionClosed) => void>();
  let requestId = 0;
  let closed = false;
  let closeNotified = false;
  let unexpectedClose: CodexAppServerSessionClosed | undefined;
  const send = (message: unknown): void => {
    if (closed || !transport.writable()) {
      throw new Error('Codex app-server session is closed');
    }
    transport.write(JSON.stringify(message));
  };
  const rejectAll = (error: Error): void => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timeout);
      entry.reject(error);
      pending.delete(id);
    }
  };
  const notifyUnexpectedClose = (error: Error): void => {
    if (closeNotified) return;
    closeNotified = true;
    closed = true;
    unexpectedClose = { error };
    rejectAll(error);
    for (const listener of closeListeners) listener(unexpectedClose);
  };
  const handleServerRequest = async (message: JsonRpcMessage): Promise<void> => {
    const request = {
      id: message.id!,
      method: message.method!,
      params: message.params,
    };
    if (options.onServerRequest === undefined) {
      pendingServerRequests.set(request.id, request);
      for (const listener of requestListeners) listener(request);
      return;
    }
    try {
      send({ id: request.id, result: await options.onServerRequest(request) });
    } catch (error) {
      send({
        id: request.id,
        error: { code: -32000, message: errorMessage(error).slice(0, 512) },
      });
    }
  };
  transport.onLine((line) => {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }
    if (
      (typeof message.id === 'number' || typeof message.id === 'string') &&
      typeof message.method === 'string'
    ) {
      void handleServerRequest(message);
      return;
    }
    if (typeof message.id === 'number') {
      const entry = pending.get(message.id);
      if (entry === undefined) return;
      pending.delete(message.id);
      clearTimeout(entry.timeout);
      if (message.error !== undefined) {
        entry.reject(
          new CodexAppServerRequestError(
            entry.method,
            message.error.code,
            message.error.data,
            message.error.message ?? 'Codex app-server request failed'
          )
        );
      } else {
        entry.resolve(message.result);
      }
      return;
    }
    if (typeof message.method !== 'string') return;
    for (const listener of listeners) listener({ method: message.method, params: message.params });
  });
  transport.onUnexpectedClose((error) => {
    if (closed) return;
    notifyUnexpectedClose(error);
  });
  return {
    request: <T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> => {
      requestId += 1;
      const id = requestId;
      return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(
          () => {
            pending.delete(id);
            reject(new Error(`${method} timed out`));
          },
          timeoutMs ?? options.requestTimeoutMs ?? 30_000
        );
        pending.set(id, {
          method,
          resolve: (value) => resolve(value as T),
          reject,
          timeout,
        });
        try {
          send({ id, method, params: params ?? {} });
        } catch (error) {
          clearTimeout(timeout);
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    notify: (method, params) => send({ method, params: params ?? {} }),
    onNotification: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onRequest: (listener) => {
      requestListeners.add(listener);
      for (const request of pendingServerRequests.values()) queueMicrotask(() => listener(request));
      return () => requestListeners.delete(listener);
    },
    respondToRequest: (id, result) => {
      if (!pendingServerRequests.delete(id)) {
        throw new Error(`Codex app-server request ${id} is not pending`);
      }
      send({ id, result });
    },
    onClose: (listener) => {
      if (unexpectedClose !== undefined) {
        const event = unexpectedClose;
        queueMicrotask(() => listener(event));
        return () => undefined;
      }
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    close: async () => {
      if (closed) return;
      closed = true;
      rejectAll(new Error('Codex app-server session closed'));
      pendingServerRequests.clear();
      await transport.close();
    },
  };
};

const processTransport = (child: ChildProcessWithoutNullStreams): JsonRpcTransport => {
  const reader = readline.createInterface({ input: child.stdout });
  child.stderr.resume();
  return {
    writable: () => !child.stdin.destroyed && !child.stdin.writableEnded,
    write: (line) => {
      child.stdin.write(`${line}\n`);
    },
    onLine: (listener) => {
      reader.on('line', listener);
    },
    onUnexpectedClose: (listener) => {
      child.once('error', (error) => listener(error));
      child.once('exit', (code, signal) => {
        listener(
          new Error(`Codex app-server exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`)
        );
      });
    },
    close: async () => {
      reader.close();
      child.stdin.end();
      if (child.exitCode === null && child.signalCode === null) {
        const exited = await Promise.race([
          new Promise<boolean>((resolve) => child.once('close', () => resolve(true))),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_000)),
        ]);
        if (!exited) child.kill('SIGTERM');
      }
    },
  };
};

const webSocketTransport = (socket: WebSocket): JsonRpcTransport => {
  let closing = false;
  return {
    writable: () => socket.readyState === WebSocket.OPEN,
    write: (line) => {
      socket.send(line);
    },
    onLine: (listener) => {
      socket.on('message', (data) => {
        const text = Array.isArray(data)
          ? Buffer.concat(data).toString('utf8')
          : data.toString('utf8');
        for (const line of text.split('\n')) {
          if (line.trim().length > 0) listener(line);
        }
      });
    },
    onUnexpectedClose: (listener) => {
      socket.once('error', (error) => {
        if (!closing) listener(error);
      });
      socket.once('close', (code, reason) => {
        if (closing) return;
        listener(
          new Error(
            `Codex app-server daemon connection closed (code=${code} reason=${reason.toString('utf8') || 'none'})`
          )
        );
      });
    },
    close: async () => {
      closing = true;
      if (socket.readyState === WebSocket.CLOSED) return;
      const closed = new Promise<boolean>((resolve) => socket.once('close', () => resolve(true)));
      socket.close();
      const finished = await Promise.race([
        closed,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_000)),
      ]);
      if (!finished) socket.terminate();
    },
  };
};

export class CodexAppServerProcessFactory implements WorkerCodexAppServerSessionFactory {
  constructor(private readonly options: CodexAppServerProcessFactoryOptions) {}

  async open(): Promise<WorkerCodexAppServerSession> {
    const child = spawn(
      this.options.binaryPath,
      [
        ...(this.options.launcherArgs ?? []),
        ...codexFeatureDisableArgs(this.options.disableRemotePlugins, this.options.connections),
        'app-server',
      ],
      {
        env: this.options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }
    );
    const session = createJsonRpcSession(processTransport(child), this.options);
    return initializeSession(session, this.options.initializeTimeoutMs ?? 12_000);
  }
}

/**
 * Connects to the managed App Server daemon of the Worker's Codex home over its Unix control
 * socket. Every thread the Worker starts then lives in that daemon, where the home's owner can
 * attach to it with the stock Codex CLI (`codex agents`, `codex resume`).
 */
export class CodexAppServerDaemonFactory implements WorkerCodexAppServerSessionFactory {
  constructor(private readonly options: CodexAppServerDaemonFactoryOptions) {}

  async open(): Promise<WorkerCodexAppServerSession> {
    const socketPath =
      this.options.resolveSocketPath === undefined
        ? await this.resolveDaemonSocketPath()
        : await this.options.resolveSocketPath();
    const socket = await this.connect(socketPath);
    const session = createJsonRpcSession(webSocketTransport(socket), this.options);
    return initializeSession(session, this.options.initializeTimeoutMs ?? 12_000);
  }

  private async resolveDaemonSocketPath(): Promise<string> {
    const configured =
      this.options.socketPath ?? defaultCodexDaemonSocketPath(this.options.codexHome);
    let started: string | undefined;
    if (this.options.ensureDaemon !== false) {
      // Feature disables travel in each thread's own config, so the home's config.toml and an
      // already-running daemon (possibly the owner's personal one) are left untouched unless the
      // caller explicitly opts into writing them.
      const features =
        this.options.writeHomeFeatureDisables === true
          ? await ensureCodexHomeFeatureDisables(this.options.codexHome, this.options)
          : { changed: false };
      started = await this.startDaemon(features.changed);
    }
    const candidate = started ?? configured;
    if (candidate.startsWith('ws:') && this.options.ensureDaemon === false) return candidate;
    try {
      // The daemon publishes a symlink into a short temp directory because Unix socket paths are
      // length-limited; connect to the resolved target.
      return await realpath(candidate);
    } catch (error) {
      throw new Error(
        `Codex App Server daemon socket is not available at ${candidate} (${errorMessage(error)}). Start it with \`CODEX_HOME=${this.options.codexHome} codex app-server daemon start\` or use --app-server-mode private-stdio.`
      );
    }
  }

  private async startDaemon(restart = false): Promise<string | undefined> {
    const args = buildCodexDaemonStartArgs({ ...this.options, restart });
    const timeoutMs = this.options.daemonStartTimeoutMs ?? 60_000;
    return new Promise<string | undefined>((resolve, reject) => {
      const child = spawn(this.options.binaryPath, [...args], {
        env: { ...this.options.env, CODEX_HOME: this.options.codexHome },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`codex app-server daemon start timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(
            new Error(
              `codex app-server daemon start failed (code=${code ?? 'null'}): ${stderr.trim().slice(-512) || stdout.trim().slice(-512)}`
            )
          );
          return;
        }
        resolve(parseDaemonSocketPath(stdout));
      });
    });
  }

  private connect(socketPath: string): Promise<WebSocket> {
    const timeoutMs = this.options.connectTimeoutMs ?? 10_000;
    return new Promise<WebSocket>((resolve, reject) => {
      const socket = socketPath.startsWith('ws:')
        ? localAppServerWebSocket(
            socketPath,
            this.options.env?.AGENT_TEAMS_APP_SERVER_TOKEN ??
              process.env.AGENT_TEAMS_APP_SERVER_TOKEN
          )
        : new WebSocket(`ws+unix://${socketPath}:/`);
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error(`Connecting to Codex App Server daemon at ${socketPath} timed out`));
      }, timeoutMs);
      socket.once('open', () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(
          new Error(
            `Could not connect to Codex App Server daemon at ${socketPath}: ${error.message}`
          )
        );
      });
      socket.once('unexpected-response', (_request, response) => {
        clearTimeout(timer);
        socket.terminate();
        reject(
          new Error(
            `Codex App Server daemon at ${socketPath} rejected the connection (HTTP ${response.statusCode ?? 'unknown'})`
          )
        );
      });
    });
  }
}

/** `codex app-server daemon start` prints JSON lines; the last object carries `socketPath`. */
export const parseDaemonSocketPath = (output: string): string | undefined => {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{'));
  for (const line of lines.reverse()) {
    try {
      const parsed = JSON.parse(line) as { socketPath?: unknown };
      if (typeof parsed.socketPath === 'string' && parsed.socketPath.length > 0) {
        return parsed.socketPath;
      }
    } catch {
      // Not every line is JSON; keep scanning.
    }
  }
  return undefined;
};
