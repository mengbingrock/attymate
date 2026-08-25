// @vitest-environment node

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  type RuntimeSessionCreated,
  teamIdSchema,
  workerInstanceIdSchema,
} from '@claude-teams/agent-teams-protocol';
import { startAgentTeamsRelay } from '@claude-teams/agent-teams-relay';
import {
  type CodexAppServerNotification,
  type CodexAppServerRequest,
  type CodexAppServerSessionClosed,
  startAgentTeamsWorker,
  type WorkerCodexAppServerSession,
} from '@claude-teams/agent-teams-worker';
import { createDistributedAgentTeamsFeature } from '@features/distributed-agent-teams/main';
import { describe, expect, it, vi } from 'vitest';

const MANAGER_TOKEN = 'manager-token-which-is-long-enough-for-tests';
const WORKER_TOKEN = 'worker-token-which-is-long-enough-for-tests';

class InteractiveCodexSession implements WorkerCodexAppServerSession {
  readonly requests: Array<{ method: string; params: unknown }> = [];
  readonly notificationListeners = new Set<
    (notification: CodexAppServerNotification) => void
  >();
  readonly requestListeners = new Set<(request: CodexAppServerRequest) => void>();
  readonly requestResponses: Array<{ id: number | string; result: unknown }> = [];

  request = async <T>(method: string, params?: unknown): Promise<T> => {
    this.requests.push({ method, params });
    if (method === 'thread/start') return { thread: { id: 'thr_remote' } } as T;
    if (method === 'turn/start') {
      return { turn: { id: 'turn_remote', status: 'inProgress' } } as T;
    }
    if (method === 'turn/steer') return { turnId: 'turn_remote' } as T;
    return {} as T;
  };

  notify = (): void => undefined;
  onNotification = (listener: (notification: CodexAppServerNotification) => void) => {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  };
  onRequest = (listener: (request: CodexAppServerRequest) => void) => {
    this.requestListeners.add(listener);
    return () => this.requestListeners.delete(listener);
  };
  respondToRequest = (id: number | string, result: unknown): void => {
    this.requestResponses.push({ id, result });
  };
  onClose = (_listener: (event: CodexAppServerSessionClosed) => void) => () => undefined;
  close = async (): Promise<void> => undefined;

  emit(method: string, params: unknown): void {
    for (const listener of this.notificationListeners) listener({ method, params });
  }

  emitRequest(id: number, method: string, params: unknown): void {
    for (const listener of this.requestListeners) listener({ id, method, params });
  }
}

const jsonRequest = async (
  url: string,
  token: string,
  init: RequestInit = {}
): Promise<Response> =>
  await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });

describe('authenticated remote Codex runtime bridge', () => {
  it('streams App Server events and steers only the exact active lease', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'agent-teams-runtime-bridge-'));
    const ids = {
      organizationId: organizationIdSchema.parse('10000000-0000-4000-8000-000000000001'),
      personId: personIdSchema.parse('10000000-0000-4000-8000-000000000002'),
      nodeId: nodeIdSchema.parse('10000000-0000-4000-8000-000000000003'),
      workerInstanceId: workerInstanceIdSchema.parse(
        '10000000-0000-4000-8000-000000000004'
      ),
      teamId: teamIdSchema.parse('10000000-0000-4000-8000-000000000005'),
    };
    const relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: join(dataRoot, 'relay'),
      heartbeatIntervalMs: 20,
      leaseDurationMs: 5_000,
      auth: { managerToken: MANAGER_TOKEN, workerToken: WORKER_TOKEN },
    });
    const workspace = join(dataRoot, 'workspace');
    await mkdir(join(workspace, 'src'), { recursive: true });
    await writeFile(join(workspace, 'src', 'remote.ts'), 'export const remote = 1;\n', 'utf8');
    const codex = new InteractiveCodexSession();
    const worker = await startAgentTeamsWorker({
      relayUrl: relay.wsUrl,
      relayToken: WORKER_TOKEN,
      dataDir: join(dataRoot, 'worker'),
      organizationId: ids.organizationId,
      personId: ids.personId,
      nodeId: ids.nodeId,
      workerInstanceId: ids.workerInstanceId,
      workerGeneration: 1,
      label: 'Interactive Worker',
      codexRuntime: {
        cwd: workspace,
        sessionFactory: { open: async () => codex },
      },
    });
    let workerStopped = false;

    try {
      await worker.ready;
      const manager = createDistributedAgentTeamsFeature({
        relayUrl: relay.httpUrl,
        managerToken: MANAGER_TOKEN,
      });
      await manager.createRemoteAssignment({
        teamId: ids.teamId,
        targetNodeId: ids.nodeId,
        title: 'Interactive remote task',
      });
      await vi.waitFor(() => expect(worker.listAssignments()).toHaveLength(1));
      const assignmentId = worker.listAssignments()[0]!.assignmentId;
      await vi.waitFor(async () => {
        await expect(manager.getAssignmentEvents()).resolves.toMatchObject({
          events: [expect.objectContaining({ assignmentId, state: 'proposed', revision: 0 })],
        });
      });
      await expect(manager.startTeam({ teamId: ids.teamId })).resolves.toMatchObject({
        teamId: ids.teamId,
        status: 'starting',
        assignmentCommandIds: [expect.any(String)],
      });
      await vi.waitFor(() =>
        expect(worker.listRuntimeBindings()[0]).toMatchObject({ state: 'active' })
      );
      expect(worker.listAssignments()[0]).toMatchObject({ state: 'running', revision: 5 });
      const lease = relay.listLeases()[0]!;

      const createResponse = await jsonRequest(
        `${relay.httpUrl}/v2/runtime-sessions`,
        MANAGER_TOKEN,
        {
          method: 'POST',
          body: JSON.stringify({
            teamId: ids.teamId,
            nodeId: ids.nodeId,
            assignmentId,
            attemptId: lease.attemptId,
            leaseEpoch: lease.leaseEpoch,
          }),
        }
      );
      expect(createResponse.status).toBe(201);
      const created = (await createResponse.json()) as RuntimeSessionCreated;

      codex.emit('item/agentMessage/delta', {
        threadId: 'thr_remote',
        turnId: 'turn_remote',
        itemId: 'item_1',
        delta: 'Remote output',
      });
      await vi.waitFor(async () => {
        const response = await jsonRequest(
          `${relay.httpUrl}/v2/runtime-sessions/${created.sessionId}/events?after=0`,
          created.sessionToken
        );
        expect(response.status).toBe(200);
        const replay = (await response.json()) as { events: unknown[] };
        expect(replay.events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              event: expect.objectContaining({
                kind: 'app-server.notification',
                payload: expect.objectContaining({ method: 'item/agentMessage/delta' }),
              }),
            }),
          ])
        );
      });

      const controlResponse = await jsonRequest(
        `${relay.httpUrl}/v2/runtime-sessions/${created.sessionId}/controls`,
        created.sessionToken,
        {
          method: 'POST',
          body: JSON.stringify({
            controlId: '10000000-0000-4000-8000-000000000008',
            type: 'turn.steer',
            payload: {
              threadId: 'thr_remote',
              expectedTurnId: 'turn_remote',
              appServerGeneration: 1,
              message: 'Inspect the failing test next.',
            },
          }),
        }
      );
      expect(controlResponse.status).toBe(202);
      await vi.waitFor(() =>
        expect(codex.requests).toContainEqual({
          method: 'turn/steer',
          params: {
            threadId: 'thr_remote',
            input: [{ type: 'text', text: 'Inspect the failing test next.' }],
            expectedTurnId: 'turn_remote',
          },
        })
      );

      codex.emitRequest(42, 'item/commandExecution/requestApproval', {
        threadId: 'thr_remote',
        turnId: 'turn_remote',
        command: 'pnpm test',
      });
      const approvalResponse = await jsonRequest(
        `${relay.httpUrl}/v2/runtime-sessions/${created.sessionId}/controls`,
        created.sessionToken,
        {
          method: 'POST',
          body: JSON.stringify({
            controlId: '10000000-0000-4000-8000-000000000009',
            type: 'approval.resolve',
            payload: { approvalRequestId: 42, decision: 'accept' },
          }),
        }
      );
      expect(approvalResponse.status).toBe(202);
      await vi.waitFor(() =>
        expect(codex.requestResponses).toContainEqual({ id: 42, result: { decision: 'accept' } })
      );

      codex.emit('turn/completed', {
        turn: { id: 'turn_remote', status: 'completed', items: [], error: null },
      });
      await vi.waitFor(() =>
        expect(worker.listAssignments()[0]).toMatchObject({ state: 'verifying' })
      );
      await vi.waitFor(async () => {
        const response = await jsonRequest(
          `${relay.httpUrl}/v2/runtime-sessions/${created.sessionId}/events?after=0`,
          created.sessionToken
        );
        const replay = (await response.json()) as {
          events: Array<{ event: { kind: string; payload: unknown } }>;
        };
        expect(replay.events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              event: {
                kind: 'runtime.snapshot',
                payload: { binding: expect.objectContaining({ state: 'completed' }) },
              },
            }),
          ])
        );
      });
      const continuationResponse = await jsonRequest(
        `${relay.httpUrl}/v2/runtime-sessions/${created.sessionId}/controls`,
        created.sessionToken,
        {
          method: 'POST',
          body: JSON.stringify({
            controlId: '10000000-0000-4000-8000-000000000011',
            type: 'turn.start',
            payload: {
              threadId: 'thr_remote',
              appServerGeneration: 1,
              message: 'Continue after the completed turn.',
            },
          }),
        }
      );
      expect(continuationResponse.status).toBe(202);
      await vi.waitFor(() => {
        expect(worker.listAssignments()[0]).toMatchObject({ state: 'running' });
        expect(
          codex.requests.filter((request) => request.method === 'turn/start')
        ).toHaveLength(2);
      });

      const readControlId = '10000000-0000-4000-8000-000000000010';
      const readResponse = await jsonRequest(
        `${relay.httpUrl}/v2/runtime-sessions/${created.sessionId}/controls`,
        created.sessionToken,
        {
          method: 'POST',
          body: JSON.stringify({
            controlId: readControlId,
            type: 'filesystem.read',
            payload: { path: 'src/remote.ts' },
          }),
        }
      );
      expect(readResponse.status).toBe(202);
      let remoteFile: { revision: string; content: string } | undefined;
      await vi.waitFor(async () => {
        const response = await jsonRequest(
          `${relay.httpUrl}/v2/runtime-sessions/${created.sessionId}/events?after=0`,
          created.sessionToken
        );
        const replay = (await response.json()) as {
          events: Array<{ event: { kind: string; payload: unknown } }>;
        };
        const result = replay.events
          .map((event) => event.event.payload as Record<string, unknown>)
          .find((payload) => payload.controlId === readControlId && payload.ok === true);
        remoteFile = result?.result as { revision: string; content: string } | undefined;
        expect(remoteFile).toMatchObject({ content: 'export const remote = 1;\n' });
      });

      const writeResponse = await jsonRequest(
        `${relay.httpUrl}/v2/runtime-sessions/${created.sessionId}/controls`,
        created.sessionToken,
        {
          method: 'POST',
          body: JSON.stringify({
            controlId: '10000000-0000-4000-8000-000000000011',
            type: 'filesystem.write',
            payload: {
              path: 'src/remote.ts',
              content: 'export const remote = 2;\n',
              expectedRevision: remoteFile!.revision,
            },
          }),
        }
      );
      expect(writeResponse.status).toBe(202);
      await vi.waitFor(async () =>
        expect(await readFile(join(workspace, 'src', 'remote.ts'), 'utf8')).toBe(
          'export const remote = 2;\n'
        )
      );

      const denied = await jsonRequest(
        `${relay.httpUrl}/v2/runtime-sessions/${created.sessionId}/events?after=0`,
        'wrong-session-token-which-is-long-enough'
      );
      expect(denied.status).toBe(401);

      const interruptResponse = await jsonRequest(
        `${relay.httpUrl}/v2/runtime-sessions/${created.sessionId}/controls`,
        created.sessionToken,
        {
          method: 'POST',
          body: JSON.stringify({
            controlId: '10000000-0000-4000-8000-000000000012',
            type: 'turn.interrupt',
            payload: { reason: 'operator_interrupt' },
          }),
        }
      );
      expect(interruptResponse.status).toBe(202);
      await vi.waitFor(() =>
        expect(worker.listAssignments()[0]).toMatchObject({
          state: 'fenced',
          decisionReason: 'remote_operator_interrupt',
        })
      );
      await vi.waitFor(async () => {
        const revokedRead = await jsonRequest(
          `${relay.httpUrl}/v2/runtime-sessions/${created.sessionId}/events?after=0`,
          created.sessionToken
        );
        expect(revokedRead.status).toBe(401);
      });

      await worker.stop();
      workerStopped = true;
      await vi.waitFor(async () => {
        const fencedRead = await jsonRequest(
          `${relay.httpUrl}/v2/runtime-sessions/${created.sessionId}/events?after=0`,
          created.sessionToken
        );
        expect(fencedRead.status).toBe(401);
      });
    } finally {
      if (!workerStopped) await worker.stop();
      await relay.close();
    }
  });
});
