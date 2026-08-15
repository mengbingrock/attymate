// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assignmentIdSchema,
  attemptIdSchema,
  commandEnvelopeSchema,
  commandIdSchema,
  leaseIdSchema,
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  workerInstanceIdSchema,
} from '@claude-teams/agent-teams-protocol';
import { startAgentTeamsRelay } from '@claude-teams/agent-teams-relay';
import {
  type CodexAppServerNotification,
  type CodexAppServerSessionClosed,
  startAgentTeamsWorker,
  type WorkerAssignment,
  type WorkerCodexAppServerSession,
  WorkerCodexRuntimeSupervisor,
} from '@claude-teams/agent-teams-worker';
import { describe, expect, it, vi } from 'vitest';

class FakeCodexSession implements WorkerCodexAppServerSession {
  readonly requests: Array<{ method: string; params: unknown }> = [];
  readonly listeners = new Set<(notification: CodexAppServerNotification) => void>();
  readonly closeListeners = new Set<(event: CodexAppServerSessionClosed) => void>();
  readonly responses = new Map<string, unknown>();
  closed = false;

  request = async <T>(method: string, params?: unknown): Promise<T> => {
    this.requests.push({ method, params });
    if (this.responses.has(method)) return this.responses.get(method) as T;
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

  onClose = (listener: (event: CodexAppServerSessionClosed) => void): (() => void) => {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  };

  close = async (): Promise<void> => {
    this.closed = true;
  };

  emit(method: string, params: unknown): void {
    for (const listener of this.listeners) listener({ method, params });
  }

  crash(message = 'fixture app-server crash'): void {
    for (const listener of this.closeListeners) listener({ error: new Error(message) });
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

  it('reads and rejoins the persisted turn after an app-server crash without replaying it', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'agent-teams-codex-recovery-'));
    const relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: join(dataRoot, 'relay'),
      heartbeatIntervalMs: 20,
      leaseDurationMs: 2_000,
    });
    const firstSession = new FakeCodexSession();
    const recoveredSession = new FakeCodexSession();
    const persistedThread = {
      id: 'thr_assignment_1',
      status: { type: 'active', activeFlags: [] },
      turns: [{ id: 'turn_assignment_1', status: 'inProgress', error: null }],
    };
    recoveredSession.responses.set('thread/read', { thread: persistedThread });
    recoveredSession.responses.set('thread/resume', { thread: persistedThread });
    const sessions = [firstSession, recoveredSession];
    const worker = await startAgentTeamsWorker({
      relayUrl: relay.wsUrl,
      dataDir: join(dataRoot, 'worker'),
      organizationId: ids.organizationId,
      personId: ids.personId,
      nodeId: ids.nodeId,
      workerInstanceId: ids.workerInstanceId,
      workerGeneration: 1,
      label: 'Recovering Codex Runtime Worker',
      reconnectDelayMs: 1_000,
      leaseSweepIntervalMs: 10,
      codexRuntime: {
        cwd: join(dataRoot, 'workspace'),
        sessionFactory: {
          open: async () => {
            const session = sessions.shift();
            if (session === undefined) throw new Error('Unexpected extra app-server launch');
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
          payload: { assignmentId: ids.assignmentId, title: 'Recover without replay' },
        })
      );
      await vi.waitFor(() => expect(worker.listAssignments()).toHaveLength(1));
      worker.acceptAssignment({ assignmentId: ids.assignmentId, expectedRevision: 0 });
      await vi.waitFor(() =>
        expect(worker.listRuntimeBindings()[0]).toMatchObject({
          state: 'active',
          appServerGeneration: 1,
        })
      );

      firstSession.crash();

      await vi.waitFor(() => {
        const binding = worker.listRuntimeBindings()[0];
        expect(binding).toMatchObject({
          state: 'active',
          appServerGeneration: 2,
        });
        expect(binding?.reconciliationState).toBeUndefined();
      });
      expect(recoveredSession.requests.map(({ method }) => method)).toEqual([
        'thread/read',
        'thread/resume',
      ]);
      expect(recoveredSession.requests).not.toContainEqual(
        expect.objectContaining({ method: 'turn/start' })
      );
      expect(worker.listAssignments()[0]).toMatchObject({ state: 'running' });
    } finally {
      await worker.stop();
      await relay.close();
    }
  });

  it('requires reconciliation when crash history cannot prove the exact turn state', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'agent-teams-codex-ambiguous-'));
    const firstSession = new FakeCodexSession();
    const recoverySession = new FakeCodexSession();
    recoverySession.responses.set('thread/read', {
      thread: { id: 'thr_assignment_1', status: { type: 'idle' }, turns: [] },
    });
    const sessions = [firstSession, recoverySession];
    const reconciliationErrors: Error[] = [];
    const supervisor = new WorkerCodexRuntimeSupervisor({
      dataDir: dataRoot,
      cwd: join(dataRoot, 'workspace'),
      sessionFactory: {
        open: async () => {
          const session = sessions.shift();
          if (session === undefined) throw new Error('Unexpected extra app-server launch');
          return session;
        },
      },
      onReconciliationRequired: (_binding, error) => reconciliationErrors.push(error),
    });
    const assignment: WorkerAssignment = {
      assignmentId: assignmentIdSchema.parse(ids.assignmentId),
      offerCommandId: commandIdSchema.parse(ids.commandId),
      targetNodeId: ids.nodeId,
      title: 'Do not replay an ambiguous turn',
      state: 'running',
      revision: 3,
      offeredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attemptId: attemptIdSchema.parse('00000000-0000-4000-8000-000000000007'),
      leaseId: leaseIdSchema.parse('00000000-0000-4000-8000-000000000008'),
      leaseEpoch: 1,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    };

    try {
      await supervisor.start(assignment);
      firstSession.crash();

      await vi.waitFor(() =>
        expect(supervisor.listBindings()[0]).toMatchObject({
          state: 'failed',
          reconciliationState: 'needs_reconciliation',
          turnStatus: 'needsReconciliation',
          appServerGeneration: 2,
        })
      );
      expect(recoverySession.requests.map(({ method }) => method)).toEqual(['thread/read']);
      expect(reconciliationErrors).toHaveLength(1);
    } finally {
      await supervisor.close();
    }
  });
});
