// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  commandEnvelopeSchema,
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  workerInstanceIdSchema,
} from '@claude-teams/agent-teams-protocol';
import { startAgentTeamsRelay } from '@claude-teams/agent-teams-relay';
import {
  type CodexAppServerNotification,
  startAgentTeamsWorker,
  type WorkerCodexAppServerSession,
} from '@claude-teams/agent-teams-worker';
import { describe, expect, it, vi } from 'vitest';

class FakeCodexSession implements WorkerCodexAppServerSession {
  readonly requests: Array<{ method: string; params: unknown }> = [];
  readonly listeners = new Set<(notification: CodexAppServerNotification) => void>();
  closed = false;

  request = async <T>(method: string, params?: unknown): Promise<T> => {
    this.requests.push({ method, params });
    if (method === 'thread/start') return { thread: { id: 'thr_assignment_1' } } as T;
    if (method === 'turn/start') {
      return { turn: { id: 'turn_assignment_1', status: 'inProgress' } } as T;
    }
    return {} as T;
  };

  notify = (): void => undefined;

  onNotification = (listener: (notification: CodexAppServerNotification) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  close = async (): Promise<void> => {
    this.closed = true;
  };

  emit(method: string, params: unknown): void {
    for (const listener of this.listeners) listener({ method, params });
  }
}

const ids = {
  nodeId: nodeIdSchema.parse('00000000-0000-4000-8000-000000000001'),
  organizationId: organizationIdSchema.parse('00000000-0000-4000-8000-000000000002'),
  personId: personIdSchema.parse('00000000-0000-4000-8000-000000000003'),
  workerInstanceId: workerInstanceIdSchema.parse('00000000-0000-4000-8000-000000000004'),
  assignmentId: '00000000-0000-4000-8000-000000000005',
  commandId: '00000000-0000-4000-8000-000000000006',
};

describe('Worker-owned Codex runtime lease lifecycle', () => {
  it('starts one scoped turn after lease reconciliation and projects completion', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'agent-teams-codex-runtime-'));
    const runtimeCwd = join(dataRoot, 'workspace');
    const relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: join(dataRoot, 'relay'),
      heartbeatIntervalMs: 20,
      leaseDurationMs: 500,
    });
    const session = new FakeCodexSession();
    let openCount = 0;
    const worker = await startAgentTeamsWorker({
      relayUrl: relay.wsUrl,
      dataDir: join(dataRoot, 'worker'),
      organizationId: ids.organizationId,
      personId: ids.personId,
      nodeId: ids.nodeId,
      workerInstanceId: ids.workerInstanceId,
      workerGeneration: 1,
      label: 'Codex Runtime Worker',
      reconnectDelayMs: 1_000,
      leaseSweepIntervalMs: 10,
      codexRuntime: {
        cwd: runtimeCwd,
        sessionFactory: {
          open: async () => {
            openCount += 1;
            return session;
          },
        },
      },
    });

    try {
      await worker.ready;
      relay.enqueueCommand(
        commandEnvelopeSchema.parse({
          protocolVersion: 2,
          commandId: ids.commandId,
          sequence: 1,
          targetNodeId: ids.nodeId,
          assignmentId: ids.assignmentId,
          type: 'assignment.offer',
          payload: {
            assignmentId: ids.assignmentId,
            title: 'Run the scoped Codex task',
            description: 'Make the requested test-only change.',
          },
        })
      );
      await vi.waitFor(() => expect(worker.listAssignments()).toHaveLength(1));
      worker.acceptAssignment({ assignmentId: ids.assignmentId, expectedRevision: 0 });

      await vi.waitFor(() => {
        expect(worker.listAssignments()[0]).toMatchObject({ state: 'running' });
        expect(worker.listRuntimeBindings()[0]).toMatchObject({
          state: 'active',
          threadId: 'thr_assignment_1',
          turnId: 'turn_assignment_1',
          appServerGeneration: 1,
        });
      });
      expect(openCount).toBe(1);
      expect(session.requests).toEqual([
        expect.objectContaining({
          method: 'thread/start',
          params: expect.objectContaining({
            cwd: runtimeCwd,
            approvalPolicy: 'never',
            sandbox: 'workspaceWrite',
          }),
        }),
        expect.objectContaining({
          method: 'turn/start',
          params: expect.objectContaining({
            threadId: 'thr_assignment_1',
            cwd: runtimeCwd,
            sandboxPolicy: expect.objectContaining({ writableRoots: [runtimeCwd] }),
          }),
        }),
      ]);

      session.emit('turn/completed', {
        turn: { id: 'turn_assignment_1', status: 'completed', items: [], error: null },
      });
      await vi.waitFor(() => {
        expect(worker.listAssignments()[0]).toMatchObject({ state: 'verifying' });
        expect(worker.listRuntimeBindings()[0]).toMatchObject({ state: 'completed' });
      });
    } finally {
      await worker.stop();
      await relay.close();
    }
  });

  it('interrupts the exact active turn when its lease expires offline', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'agent-teams-codex-fence-'));
    const relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: join(dataRoot, 'relay'),
      heartbeatIntervalMs: 20,
      leaseDurationMs: 140,
    });
    const session = new FakeCodexSession();
    const worker = await startAgentTeamsWorker({
      relayUrl: relay.wsUrl,
      dataDir: join(dataRoot, 'worker'),
      organizationId: ids.organizationId,
      personId: ids.personId,
      nodeId: ids.nodeId,
      workerInstanceId: ids.workerInstanceId,
      workerGeneration: 1,
      label: 'Fenced Codex Runtime Worker',
      reconnectDelayMs: 1_000,
      leaseSweepIntervalMs: 10,
      codexRuntime: {
        cwd: join(dataRoot, 'workspace'),
        sessionFactory: { open: async () => session },
      },
    });
    let relayClosed = false;

    try {
      await worker.ready;
      relay.enqueueCommand(
        commandEnvelopeSchema.parse({
          protocolVersion: 2,
          commandId: ids.commandId,
          sequence: 1,
          targetNodeId: ids.nodeId,
          assignmentId: ids.assignmentId,
          type: 'assignment.offer',
          payload: { assignmentId: ids.assignmentId, title: 'Interrupt on lease loss' },
        })
      );
      await vi.waitFor(() => expect(worker.listAssignments()).toHaveLength(1));
      worker.acceptAssignment({ assignmentId: ids.assignmentId, expectedRevision: 0 });
      await vi.waitFor(() =>
        expect(worker.listAssignments()[0]).toMatchObject({ state: 'running' })
      );

      await relay.close();
      relayClosed = true;
      await vi.waitFor(
        () => {
          expect(worker.listAssignments()[0]).toMatchObject({ state: 'fenced' });
          expect(worker.listRuntimeBindings()[0]).toMatchObject({ state: 'interrupted' });
          expect(session.requests).toContainEqual({
            method: 'turn/interrupt',
            params: { threadId: 'thr_assignment_1', turnId: 'turn_assignment_1' },
          });
        },
        { timeout: 2_000 }
      );
    } finally {
      await worker.stop();
      if (!relayClosed) await relay.close();
    }
  });
});
