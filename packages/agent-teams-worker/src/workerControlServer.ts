import { chmod, lstat, mkdir, unlink } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  request as httpRequest,
  type Server,
  type ServerResponse,
} from 'node:http';
import { dirname } from 'node:path';

import type { AgentTeamsWorkerStatus } from './workerDaemon';
import type {
  AssignmentDeferInput,
  AssignmentMutationInput,
  WorkerAssignment,
  WorkerAssignmentActivity,
} from './workerAssignmentStore';
import type { WorkerInboxCommand } from './workerInboxStore';
import type { WorkerTeamMessage } from './workerMessageStore';

const MAX_CONTROL_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_CONTROL_REQUEST_BYTES = 64 * 1024;

export interface WorkerControlSnapshotProvider {
  readonly getStatus: () => AgentTeamsWorkerStatus;
  readonly listInboxCommands: () => readonly WorkerInboxCommand[];
  readonly listMessages: () => readonly WorkerTeamMessage[];
  readonly markMessageRead: (messageId: string) => WorkerTeamMessage;
  readonly listAssignments: () => readonly WorkerAssignment[];
  readonly getAssignment: (assignmentId: string) => WorkerAssignment | undefined;
  readonly listAssignmentActivity: (assignmentId?: string) => readonly WorkerAssignmentActivity[];
  readonly acceptAssignment: (input: AssignmentMutationInput) => WorkerAssignment;
  readonly rejectAssignment: (input: AssignmentMutationInput) => WorkerAssignment;
  readonly deferAssignment: (input: AssignmentDeferInput) => WorkerAssignment;
  readonly executeRuntimeTool?: (input: {
    readonly token: string;
    readonly toolName: string;
    readonly arguments: Readonly<Record<string, unknown>>;
    readonly idempotencyKey: string;
  }) => unknown;
}

export interface StartedWorkerControlServer {
  readonly socketPath: string;
  readonly close: () => Promise<void>;
}

export interface WorkerAgentContextProjection {
  readonly protocolVersion: 2;
  readonly coordinationMode: 'lan_relay_v2';
  readonly profile: 'agent-teams-control';
  readonly insecureLanMode: boolean;
  readonly organizationId: AgentTeamsWorkerStatus['organizationId'];
  readonly personId: AgentTeamsWorkerStatus['personId'];
  readonly nodeId: AgentTeamsWorkerStatus['nodeId'];
  readonly workerInstanceId: AgentTeamsWorkerStatus['workerInstanceId'];
  readonly workerState: AgentTeamsWorkerStatus['state'];
}

const isWindowsPipe = (socketPath: string): boolean => socketPath.startsWith('\\\\.\\pipe\\');

const removeStaleSocket = async (socketPath: string): Promise<void> => {
  try {
    const stat = await lstat(socketPath);
    if (!stat.isSocket()) {
      throw new Error(`Worker control path exists and is not a socket: ${socketPath}`);
    }
    await unlink(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
};

const jsonResponse = (response: ServerResponse, body: unknown, statusCode = 200): void => {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Worker control request body must be an object');
  }
  return value as Record<string, unknown>;
};

const readJsonBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.length;
    if (receivedBytes > MAX_CONTROL_REQUEST_BYTES) {
      throw new Error('Worker control request exceeded size limit');
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return asRecord(JSON.parse(Buffer.concat(chunks).toString('utf8')));
};

const normalizeMutationInput = (
  assignmentId: string,
  body: Record<string, unknown>,
  allowDeferredUntil: boolean
): AssignmentDeferInput => {
  const allowed = new Set([
    'expectedRevision',
    'reason',
    ...(allowDeferredUntil ? ['deferredUntil'] : []),
  ]);
  for (const field of Object.keys(body)) {
    if (!allowed.has(field)) throw new TypeError(`Unknown Worker control field ${field}`);
  }
  if (
    body.expectedRevision !== undefined &&
    (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 0)
  ) {
    throw new TypeError('expectedRevision must be a non-negative integer');
  }
  if (body.reason !== undefined && typeof body.reason !== 'string') {
    throw new TypeError('reason must be a string');
  }
  if (body.deferredUntil !== undefined && typeof body.deferredUntil !== 'string') {
    throw new TypeError('deferredUntil must be a string');
  }
  return {
    assignmentId,
    ...(body.expectedRevision === undefined
      ? {}
      : { expectedRevision: body.expectedRevision as number }),
    ...(body.reason === undefined ? {} : { reason: body.reason as string }),
    ...(body.deferredUntil === undefined ? {} : { deferredUntil: body.deferredUntil as string }),
  };
};

const errorStatus = (error: unknown): number => {
  if (!(error instanceof Error)) return 500;
  if (error.name === 'ZodError') return 400;
  if ('code' in error && error.code === 'RUNTIME_MCP_SESSION_DENIED') return 401;
  if ('code' in error && error.code === 'MCP_CAPABILITY_DENIED') return 403;
  if ('code' in error && error.code === 'RUNTIME_AUTHORITY_ARGUMENT_REJECTED') return 400;
  if ('code' in error && error.code === 'WORKER_ASSIGNMENT_NOT_FOUND') return 404;
  if ('code' in error && error.code === 'WORKER_MESSAGE_NOT_FOUND') return 404;
  if (
    'code' in error &&
    (error.code === 'WORKER_ASSIGNMENT_REVISION_CONFLICT' ||
      error.code === 'INVALID_ASSIGNMENT_TRANSITION')
  ) {
    return 409;
  }
  return error instanceof TypeError ? 400 : 500;
};

const bearerToken = (request: IncomingMessage): string => {
  const authorization = request.headers.authorization;
  if (authorization === undefined || !authorization.startsWith('Bearer ')) {
    throw Object.assign(new Error('Runtime MCP bearer token is required'), {
      code: 'RUNTIME_MCP_SESSION_DENIED',
    });
  }
  return authorization.slice('Bearer '.length);
};

const handleControlRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  provider: WorkerControlSnapshotProvider
): Promise<void> => {
  const url = new URL(request.url ?? '/', 'http://worker.local');
  const status = provider.getStatus();

  if (request.method === 'GET' && url.pathname === '/v2/agent-context') {
    const context: WorkerAgentContextProjection = {
      protocolVersion: 2,
      coordinationMode: 'lan_relay_v2',
      profile: 'agent-teams-control',
      insecureLanMode: status.insecureLanMode,
      organizationId: status.organizationId,
      personId: status.personId,
      nodeId: status.nodeId,
      workerInstanceId: status.workerInstanceId,
      workerState: status.state,
    };
    jsonResponse(response, context);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/v2/worker-status') {
    jsonResponse(response, status);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/v2/assignments') {
    jsonResponse(response, { assignments: provider.listAssignments() });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/v2/messages') {
    jsonResponse(response, { messages: provider.listMessages() });
    return;
  }
  const messageReadMatch = /^\/v2\/messages\/([^/]+)\/read$/.exec(url.pathname);
  if (request.method === 'POST' && messageReadMatch !== null) {
    jsonResponse(response, {
      message: provider.markMessageRead(decodeURIComponent(messageReadMatch[1] ?? '')),
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/v2/assignment-activity') {
    const assignmentId = url.searchParams.get('assignmentId') ?? undefined;
    jsonResponse(response, {
      assignments: provider.listAssignments(),
      events: provider.listAssignmentActivity(assignmentId),
      commands: provider.listInboxCommands(),
    });
    return;
  }

  const runtimeToolMatch = /^\/v2\/runtime-tools\/([a-z][a-z0-9_.-]*)$/.exec(url.pathname);
  if (request.method === 'POST' && runtimeToolMatch !== null) {
    if (provider.executeRuntimeTool === undefined) {
      throw Object.assign(new Error('Runtime MCP is not enabled'), {
        code: 'RUNTIME_MCP_SESSION_DENIED',
      });
    }
    const token = bearerToken(request);
    const body = await readJsonBody(request);
    const idempotencyKey = body.idempotencyKey;
    const toolArguments = body.arguments;
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(idempotencyKey)) {
      throw new TypeError('Runtime MCP idempotencyKey is invalid');
    }
    if (typeof toolArguments !== 'object' || toolArguments === null || Array.isArray(toolArguments)) {
      throw new TypeError('Runtime MCP arguments must be an object');
    }
    jsonResponse(
      response,
      provider.executeRuntimeTool({
        token,
        toolName: runtimeToolMatch[1]!,
        arguments: toolArguments as Readonly<Record<string, unknown>>,
        idempotencyKey,
      })
    );
    return;
  }

  const detailMatch = /^\/v2\/assignments\/([^/]+)$/.exec(url.pathname);
  if (request.method === 'GET' && detailMatch !== null) {
    const assignment = provider.getAssignment(decodeURIComponent(detailMatch[1] ?? ''));
    if (assignment === undefined) {
      jsonResponse(response, { error: 'assignment_not_found' }, 404);
      return;
    }
    jsonResponse(response, { assignment });
    return;
  }

  const mutationMatch = /^\/v2\/assignments\/([^/]+)\/(accept|reject|defer)$/.exec(url.pathname);
  if (request.method === 'POST' && mutationMatch !== null) {
    const assignmentId = decodeURIComponent(mutationMatch[1] ?? '');
    const action = mutationMatch[2];
    const input = normalizeMutationInput(
      assignmentId,
      await readJsonBody(request),
      action === 'defer'
    );
    const assignment =
      action === 'accept'
        ? provider.acceptAssignment(input)
        : action === 'reject'
          ? provider.rejectAssignment(input)
          : provider.deferAssignment(input);
    jsonResponse(response, { assignment });
    return;
  }

  response.statusCode = request.method === 'GET' || request.method === 'POST' ? 404 : 405;
  response.end(
    JSON.stringify({ error: response.statusCode === 404 ? 'not_found' : 'method_not_allowed' })
  );
};

export const startWorkerControlServer = async (
  socketPath: string,
  provider: WorkerControlSnapshotProvider
): Promise<StartedWorkerControlServer> => {
  const windowsPipe = isWindowsPipe(socketPath);
  if (!windowsPipe) {
    await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
    await chmod(dirname(socketPath), 0o700);
    await removeStaleSocket(socketPath);
  }

  const server = createServer((request, response) => {
    void handleControlRequest(request, response, provider).catch((error: unknown) => {
      jsonResponse(
        response,
        { error: error instanceof Error ? error.message : 'Worker control request failed' },
        errorStatus(error)
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
  if (!windowsPipe) {
    try {
      await chmod(socketPath, 0o600);
    } catch (error) {
      await closeServer(server);
      await removeStaleSocket(socketPath);
      throw error;
    }
  }

  return {
    socketPath,
    close: async () => {
      await closeServer(server);
      if (!windowsPipe) await removeStaleSocket(socketPath);
    },
  };
};

const closeServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
};

export const requestWorkerControl = async <T>(
  socketPath: string,
  path:
    | '/v2/agent-context'
    | '/v2/worker-status'
    | '/v2/assignments'
    | '/v2/messages'
    | `/v2/messages/${string}/read`
    | '/v2/assignment-activity'
    | `/v2/runtime-tools/${string}`
    | `/v2/assignments/${string}`
    | `/v2/assignments/${string}/${'accept' | 'reject' | 'defer'}`,
  options?: {
    readonly method?: 'GET' | 'POST';
    readonly body?: unknown;
    readonly bearerToken?: string;
  }
): Promise<T> =>
  await new Promise<T>((resolve, reject) => {
    const request = httpRequest(
      {
        socketPath,
        path,
        method: options?.method ?? 'GET',
        headers: {
          host: 'localhost',
          ...(options?.bearerToken === undefined
            ? {}
            : { authorization: `Bearer ${options.bearerToken}` }),
          ...(options?.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        response.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length;
          if (receivedBytes > MAX_CONTROL_RESPONSE_BYTES) {
            request.destroy(new Error('Worker control response exceeded size limit'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (response.statusCode !== 200) {
            const detail = Buffer.concat(chunks).toString('utf8').slice(0, 512).trim();
            reject(
              new Error(
                `Worker control request failed with HTTP ${response.statusCode}${detail.length === 0 ? '' : `: ${detail}`}`
              )
            );
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.once('error', reject);
    request.setTimeout(5_000, () => {
      request.destroy(new Error('Worker control request timed out'));
    });
    request.end(options?.body === undefined ? undefined : JSON.stringify(options.body));
  });
