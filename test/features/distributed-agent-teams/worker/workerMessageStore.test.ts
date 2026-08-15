// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
      expect(queued).toMatchObject({ routingState: 'queued' });

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
      expect(store.acceptDelivery(command)).toEqual(store.listAll()[0]);
    } finally {
      store.close();
    }
  });
});
