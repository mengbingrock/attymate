// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  assignmentIdSchema,
  attemptIdSchema,
  commandEnvelopeSchema,
  membershipIdSchema,
  teamIdSchema,
  workspaceIdSchema,
} from '@claude-teams/agent-teams-protocol';
import { WorkerMessageStore } from '@claude-teams/agent-teams-worker';
import { describe, expect, it } from 'vitest';

const ids = {
  teamId: teamIdSchema.parse('00000000-0000-4000-8000-000000000001'),
  senderMembershipId: membershipIdSchema.parse('00000000-0000-4000-8000-000000000002'),
  recipientMembershipId: membershipIdSchema.parse('00000000-0000-4000-8000-000000000003'),
  senderWorkspaceId: workspaceIdSchema.parse('00000000-0000-4000-8000-000000000004'),
  recipientWorkspaceId: workspaceIdSchema.parse('00000000-0000-4000-8000-000000000005'),
  assignmentId: assignmentIdSchema.parse('00000000-0000-4000-8000-000000000006'),
  attemptId: attemptIdSchema.parse('00000000-0000-4000-8000-000000000007'),
} as const;

const delivery = commandEnvelopeSchema.parse({
  protocolVersion: 2,
  commandId: '00000000-0000-4000-8000-000000000008',
  sequence: 1,
  teamId: ids.teamId,
  targetNodeId: '00000000-0000-4000-8000-000000000009',
  assignmentId: ids.assignmentId,
  attemptId: ids.attemptId,
  leaseEpoch: 4,
  type: 'team.message.deliver',
  payload: {
    messageId: '00000000-0000-4000-8000-000000000010',
    senderMembershipId: ids.senderMembershipId,
    recipientMembershipId: ids.recipientMembershipId,
    senderWorkspaceId: ids.senderWorkspaceId,
    recipientWorkspaceId: ids.recipientWorkspaceId,
    sourceAssignmentId: ids.assignmentId,
    sourceAttemptId: ids.attemptId,
    sourceLeaseEpoch: 2,
    turnId: '00000000-0000-7000-8000-000000000011',
    message: 'Please review the parser boundary.',
    sentAt: '2026-08-15T20:00:00.000Z',
  },
});

describe('Worker team message inbox', () => {
  it('only exposes a delivery to the exact active execution scope', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'agent-teams-message-store-'));
    const store = new WorkerMessageStore(dataDir);
    const command = {
      cursor: 1,
      commandId: delivery.commandId,
      envelope: delivery,
      receivedAt: '2026-08-15T20:00:01.000Z',
    } as const;

    try {
      const queued = store.acceptDelivery(command, {
        teamId: ids.teamId,
        membershipId: ids.recipientMembershipId,
        workspaceId: ids.recipientWorkspaceId,
        assignmentId: ids.assignmentId,
        attemptId: ids.attemptId,
        leaseEpoch: 3,
      });
      expect(queued).toMatchObject({ routingState: 'queued', steerState: 'pending' });

      expect(
        store.reconcileActiveScope({
          teamId: ids.teamId,
          membershipId: ids.recipientMembershipId,
          workspaceId: ids.recipientWorkspaceId,
          assignmentId: ids.assignmentId,
          attemptId: ids.attemptId,
          leaseEpoch: 4,
        })
      ).toHaveLength(1);
      expect(store.listAll()[0]).toMatchObject({ routingState: 'available_active' });
      const scope = {
        teamId: ids.teamId,
        membershipId: ids.recipientMembershipId,
        workspaceId: ids.recipientWorkspaceId,
        assignmentId: ids.assignmentId,
        attemptId: ids.attemptId,
        leaseEpoch: 4,
      } as const;
      const steerIdentity = {
        threadId: 'thread-recipient',
        turnId: 'turn-recipient',
        appServerGeneration: 2,
      } as const;
      expect(
        store.beginSteer('00000000-0000-4000-8000-000000000010', scope, steerIdentity)
      ).toMatchObject({
        steerState: 'in_flight',
        steerAttempts: 1,
      });
      expect(
        store.markSteered('00000000-0000-4000-8000-000000000010', steerIdentity)
      ).toMatchObject({ steerState: 'delivered', readAt: expect.any(String) });
      expect(store.acceptDelivery(command)).toEqual(store.listAll()[0]);

      const manualDelivery = commandEnvelopeSchema.parse({
        protocolVersion: 2,
        commandId: '00000000-0000-4000-8000-000000000012',
        sequence: 2,
        teamId: ids.teamId,
        targetNodeId: '00000000-0000-4000-8000-000000000009',
        type: 'team.message.deliver',
        payload: {
          messageId: '00000000-0000-4000-8000-000000000013',
          senderMembershipId: ids.senderMembershipId,
          recipientMembershipId: ids.recipientMembershipId,
          senderWorkspaceId: ids.senderWorkspaceId,
          recipientWorkspaceId: ids.recipientWorkspaceId,
          sourceAssignmentId: ids.assignmentId,
          sourceAttemptId: ids.attemptId,
          sourceLeaseEpoch: 2,
          turnId: '00000000-0000-7000-8000-000000000011',
          message: 'Queued for explicit owner reading.',
          sentAt: '2026-08-15T20:00:02.000Z',
        },
      });
      store.acceptDelivery({
        cursor: 2,
        commandId: manualDelivery.commandId,
        envelope: manualDelivery,
        receivedAt: '2026-08-15T20:00:03.000Z',
      });
      expect(
        store.markRead('00000000-0000-4000-8000-000000000013')
      ).toMatchObject({ steerState: 'pending', readAt: expect.any(String) });
    } finally {
      store.close();
    }
  });

  it('migrates the original durable inbox without losing source or target scope', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'agent-teams-message-migration-'));
    const database = new DatabaseSync(join(dataDir, 'worker.sqlite'));
    database.exec(`
      CREATE TABLE team_messages (
        message_id TEXT PRIMARY KEY,
        delivery_command_id TEXT NOT NULL UNIQUE,
        team_id TEXT NOT NULL,
        assignment_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        lease_epoch INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        routing_state TEXT NOT NULL CHECK (routing_state IN ('queued', 'available_active')),
        received_at TEXT NOT NULL
      );
    `);
    database
      .prepare(
        `INSERT INTO team_messages VALUES (?, ?, ?, ?, ?, ?, ?, 'available_active', ?)`
      )
      .run(
        '00000000-0000-4000-8000-000000000010',
        '00000000-0000-4000-8000-000000000008',
        ids.teamId,
        ids.assignmentId,
        ids.attemptId,
        4,
        JSON.stringify({
          senderMembershipId: ids.senderMembershipId,
          recipientMembershipId: ids.recipientMembershipId,
          senderWorkspaceId: ids.senderWorkspaceId,
          recipientWorkspaceId: ids.recipientWorkspaceId,
          turnId: '00000000-0000-7000-8000-000000000011',
          message: 'Persisted before the steering upgrade.',
          messageId: '00000000-0000-4000-8000-000000000010',
          sentAt: '2026-08-15T20:00:00.000Z',
        }),
        '2026-08-15T20:00:01.000Z'
      );
    database
      .prepare(`INSERT INTO team_messages VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`)
      .run(
        '00000000-0000-4000-8000-000000000012',
        '00000000-0000-4000-8000-000000000013',
        ids.teamId,
        ids.assignmentId,
        ids.attemptId,
        4,
        JSON.stringify({
          senderMembershipId: ids.senderMembershipId,
          recipientMembershipId: ids.recipientMembershipId,
          senderWorkspaceId: ids.senderWorkspaceId,
          recipientWorkspaceId: ids.recipientWorkspaceId,
          turnId: '00000000-0000-7000-8000-000000000011',
          message: 'Queued before the steering upgrade.',
          messageId: '00000000-0000-4000-8000-000000000012',
          sentAt: '2026-08-15T20:00:02.000Z',
        }),
        '2026-08-15T20:00:03.000Z'
      );
    database.close();

    const store = new WorkerMessageStore(dataDir);
    try {
      const messages = store.listAll();
      expect(messages).toEqual([
        expect.objectContaining({
          targetAssignmentId: ids.assignmentId,
          targetAttemptId: ids.attemptId,
          targetLeaseEpoch: 4,
          steerState: 'pending',
          payload: expect.objectContaining({
            sourceAssignmentId: ids.assignmentId,
            sourceAttemptId: ids.attemptId,
            sourceLeaseEpoch: 4,
          }),
        }),
        expect.objectContaining({
          messageId: '00000000-0000-4000-8000-000000000012',
          routingState: 'queued',
          steerState: 'pending',
          payload: expect.objectContaining({
            sourceAssignmentId: ids.assignmentId,
            sourceAttemptId: ids.attemptId,
            sourceLeaseEpoch: 4,
          }),
        }),
      ]);
      expect(messages[1]).not.toHaveProperty('targetAssignmentId');
      expect(messages[1]).not.toHaveProperty('targetAttemptId');
      expect(messages[1]).not.toHaveProperty('targetLeaseEpoch');
    } finally {
      store.close();
    }
  });
});
