import { chmod, lstat, mkdir, unlink } from 'node:fs/promises';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { dirname } from 'node:path';

import type { AgentTeamsWorkerStatus } from './workerDaemon';
import type { WorkerInboxCommand } from './workerInboxStore';

const MAX_CONTROL_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface WorkerControlSnapshotProvider {
  readonly getStatus: () => AgentTeamsWorkerStatus;
  readonly listInboxCommands: () => readonly WorkerInboxCommand[];
}

export interface StartedWorkerControlServer {
  readonly socketPath: string;
  readonly close: () => Promise<void>;
}

export interface WorkerAgentContextProjection {
  readonly protocolVersion: 2;
  readonly coordinationMode: 'lan_relay_v2';
  readonly profile: 'agent-teams-control';
  readonly insecureLanMode: true;
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

const jsonResponse = (response: import('node:http').ServerResponse, body: unknown): void => {
  response.statusCode = 200;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
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
    if (request.method !== 'GET') {
      response.statusCode = 405;
      response.end();
      return;
    }

    const status = provider.getStatus();
    if (request.url === '/v2/agent-context') {
      const context: WorkerAgentContextProjection = {
        protocolVersion: 2,
        coordinationMode: 'lan_relay_v2',
        profile: 'agent-teams-control',
        insecureLanMode: true,
        organizationId: status.organizationId,
        personId: status.personId,
        nodeId: status.nodeId,
        workerInstanceId: status.workerInstanceId,
        workerState: status.state,
      };
      jsonResponse(response, context);
      return;
    }
    if (request.url === '/v2/worker-status') {
      jsonResponse(response, status);
      return;
    }
    if (request.url === '/v2/assignment-activity') {
      jsonResponse(response, { commands: provider.listInboxCommands() });
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not_found' }));
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
  path: '/v2/agent-context' | '/v2/worker-status' | '/v2/assignment-activity'
): Promise<T> =>
  await new Promise<T>((resolve, reject) => {
    const request = httpRequest(
      {
        socketPath,
        path,
        method: 'GET',
        headers: { host: 'localhost' },
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
            reject(new Error(`Worker control request failed with HTTP ${response.statusCode}`));
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
    request.end();
  });
