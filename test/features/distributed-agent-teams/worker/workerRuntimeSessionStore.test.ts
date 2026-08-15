// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  RuntimeMcpSessionAuthorizationError,
  WorkerRuntimeSessionStore,
  WorkerRuntimeStore,
} from '@claude-teams/agent-teams-worker';
import { describe, expect, it } from 'vitest';

const identity = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  personId: '00000000-0000-4000-8000-000000000002',
  nodeId: '00000000-0000-4000-8000-000000000003',
  workerInstanceId: '00000000-0000-4000-8000-000000000004',
  teamId: '00000000-0000-4000-8000-000000000005',
  membershipId: '00000000-0000-4000-8000-000000000006',
  assignmentId: '00000000-0000-4000-8000-000000000007',
  attemptId: '00000000-0000-4000-8000-000000000008',
  workspaceId: '00000000-0000-4000-8000-000000000009',
  leaseId: '00000000-0000-4000-8000-000000000010',
  threadId: '00000000-0000-7000-8000-000000000011',
  turnId: '00000000-0000-7000-8000-000000000012',
} as const;

describe('WorkerRuntimeSessionStore', () => {
  it('authorizes only an unexpired token bound to the exact active lease turn', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'agent-teams-runtime-session-'));
    const runtime = new WorkerRuntimeStore(dataDir);
    const sessions = new WorkerRuntimeSessionStore(dataDir);
    runtime.begin({
      assignmentId: identity.assignmentId,
      attemptId: identity.attemptId,
      leaseId: identity.leaseId,
      leaseEpoch: 3,
      appServerGeneration: 1,
    });
    runtime.bindThread(identity.attemptId, identity.threadId);
    runtime.bindTurn(identity.attemptId, identity.turnId);
    const created = sessions.create({
      ...identity,
      leaseEpoch: 3,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const inspection = new DatabaseSync(join(dataDir, 'worker.sqlite'));
    const storedCredential = inspection
      .prepare('SELECT token_hash FROM runtime_mcp_sessions')
      .get() as { token_hash: string };
    inspection.close();

    try {
      expect(storedCredential.token_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(storedCredential.token_hash).not.toBe(created.token);
      expect(() => sessions.authorize(created.token)).toThrow(
        RuntimeMcpSessionAuthorizationError
      );
      sessions.bindTurn(created.token, identity.turnId);
      expect(sessions.authorize(created.token)).toMatchObject({
        profile: 'agent-teams-runtime',
        assignmentId: identity.assignmentId,
        attemptId: identity.attemptId,
        leaseEpoch: 3,
        turnId: identity.turnId,
      });
      sessions.revokeAttempt(identity.attemptId);
      expect(() => sessions.authorize(created.token)).toThrow(
        RuntimeMcpSessionAuthorizationError
      );
    } finally {
      sessions.close();
      runtime.close();
    }
  });

  it('rotates a token without making the previous token usable', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'agent-teams-runtime-rotate-'));
    const runtime = new WorkerRuntimeStore(dataDir);
    const sessions = new WorkerRuntimeSessionStore(dataDir);
    runtime.begin({
      assignmentId: identity.assignmentId,
      attemptId: identity.attemptId,
      leaseId: identity.leaseId,
      leaseEpoch: 3,
      appServerGeneration: 1,
    });
    runtime.bindThread(identity.attemptId, identity.threadId);
    runtime.bindTurn(identity.attemptId, identity.turnId);
    const first = sessions.create({
      ...identity,
      leaseEpoch: 3,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    sessions.bindTurn(first.token, identity.turnId);
    const second = sessions.rotateAttempt(identity.attemptId);
    sessions.bindTurn(second.token, identity.turnId);

    try {
      expect(second.token).not.toBe(first.token);
      expect(() => sessions.authorize(first.token)).toThrow(
        RuntimeMcpSessionAuthorizationError
      );
      expect(sessions.authorize(second.token)).toMatchObject({ turnId: identity.turnId });
    } finally {
      sessions.close();
      runtime.close();
    }
  });
});
