import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';

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

export interface CodexAppServerProcessFactoryOptions {
  readonly binaryPath: string;
  readonly launcherArgs?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly requestTimeoutMs?: number;
  readonly initializeTimeoutMs?: number;
  readonly disableRemotePlugins?: boolean;
  readonly onServerRequest?: (request: CodexAppServerRequest) => Promise<unknown>;
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

export class CodexAppServerProcessFactory implements WorkerCodexAppServerSessionFactory {
  constructor(private readonly options: CodexAppServerProcessFactoryOptions) {}

  async open(): Promise<WorkerCodexAppServerSession> {
    const child = spawn(
      this.options.binaryPath,
      [
        ...(this.options.launcherArgs ?? []),
        '--disable',
        'apps',
        '--disable',
        'plugins',
        ...(this.options.disableRemotePlugins === false ? [] : ['--disable', 'remote_plugin']),
        'app-server',
      ],
      {
        env: this.options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }
    );
    const session = this.createSession(child);
    try {
      await session.request(
        'initialize',
        {
          clientInfo: {
            name: 'agent_teams_worker',
            title: 'Agent Teams Worker',
            version: '0.1.0',
          },
          capabilities: {
            experimentalApi: false,
            optOutNotificationMethods: [
              'item/agentReasoning/delta',
            ],
          },
        },
        this.options.initializeTimeoutMs ?? 12_000
      );
      session.notify('initialized', {});
      return session;
    } catch (error) {
      await session.close();
      throw error;
    }
  }

  private createSession(child: ChildProcessWithoutNullStreams): WorkerCodexAppServerSession {
    const pending = new Map<number, PendingRequest>();
    const listeners = new Set<(notification: CodexAppServerNotification) => void>();
    const requestListeners = new Set<(request: CodexAppServerRequest) => void>();
    const pendingServerRequests = new Map<number | string, CodexAppServerRequest>();
    const closeListeners = new Set<(event: CodexAppServerSessionClosed) => void>();
    const reader = readline.createInterface({ input: child.stdout });
    let requestId = 0;
    let closed = false;
    let closeNotified = false;
    let unexpectedClose: CodexAppServerSessionClosed | undefined;

    child.stderr.resume();

    const send = (message: unknown): void => {
      if (closed || child.stdin.destroyed || child.stdin.writableEnded) {
        throw new Error('Codex app-server session is closed');
      }
      child.stdin.write(`${JSON.stringify(message)}\n`);
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
      reader.close();
      for (const listener of closeListeners) listener(unexpectedClose);
    };

    const handleServerRequest = async (message: JsonRpcMessage): Promise<void> => {
      const request = {
        id: message.id!,
        method: message.method!,
        params: message.params,
      };
      if (this.options.onServerRequest === undefined) {
        pendingServerRequests.set(request.id, request);
        for (const listener of requestListeners) listener(request);
        return;
      }
      try {
        send({ id: request.id, result: await this.options.onServerRequest(request) });
      } catch (error) {
        send({
          id: request.id,
          error: { code: -32000, message: errorMessage(error).slice(0, 512) },
        });
      }
    };

    reader.on('line', (line) => {
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
      for (const listener of listeners)
        listener({ method: message.method, params: message.params });
    });

    child.once('error', (error) => notifyUnexpectedClose(error));
    child.once('exit', (code, signal) => {
      if (closed) return;
      notifyUnexpectedClose(
        new Error(`Codex app-server exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`)
      );
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
            timeoutMs ?? this.options.requestTimeoutMs ?? 30_000
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
  }
}
