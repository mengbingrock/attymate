import { ReconnectDistributedLeadUseCase } from '@features/distributed-agent-teams/core/application/use-cases/ReconnectDistributedLeadUseCase';
import { describe, expect, it, vi } from 'vitest';

import type { DistributedLocalLeadRecoveryPort } from '@features/distributed-agent-teams/core/application/ports/DistributedLocalLeadRecoveryPort';
import type { DistributedRelayPort } from '@features/distributed-agent-teams/core/application/ports/DistributedRelayPort';

const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const NODE_ID = '11111111-1111-4111-8111-111111111111';

const createRelay = (connected: boolean, includeLead = true): DistributedRelayPort =>
  ({
    listWorkers: vi.fn(async () =>
      connected
        ? [
            {
              nodeId: NODE_ID,
              label: 'Persistent lead',
              connectedAt: '2026-09-03T10:00:00.000Z',
              lastHeartbeatAt: '2026-09-03T10:00:01.000Z',
              lastHeartbeatSequence: 1,
              status: 'connected' as const,
            },
          ]
        : []
    ),
    listMembershipRoutes: vi.fn(async () =>
      includeLead
        ? [
            {
              membershipId: '33333333-3333-4333-8333-333333333333',
              teamId: TEAM_ID,
              nodeId: NODE_ID,
              workspaceId: '44444444-4444-4444-8444-444444444444',
              label: 'Persistent lead',
              role: 'lead' as const,
              status: 'active' as const,
              revision: 1,
              createdAt: '2026-09-03T10:00:00.000Z',
              updatedAt: '2026-09-03T10:00:00.000Z',
            },
          ]
        : []
    ),
  }) as unknown as DistributedRelayPort;

describe('ReconnectDistributedLeadUseCase', () => {
  it('does not launch a duplicate when the Relay lead is connected', async () => {
    const recovery: DistributedLocalLeadRecoveryPort = { reconnect: vi.fn() };
    const receipt = await new ReconnectDistributedLeadUseCase(
      createRelay(true),
      recovery
    ).execute({ teamId: TEAM_ID });

    expect(receipt).toMatchObject({ teamId: TEAM_ID, nodeId: NODE_ID, status: 'already-connected' });
    expect(recovery.reconnect).not.toHaveBeenCalled();
  });

  it('launches the configured local lead when its Relay worker is offline', async () => {
    const recovery: DistributedLocalLeadRecoveryPort = {
      reconnect: vi.fn(async () => ({ status: 'started' as const })),
    };
    const receipt = await new ReconnectDistributedLeadUseCase(
      createRelay(false),
      recovery
    ).execute({ teamId: TEAM_ID });

    expect(recovery.reconnect).toHaveBeenCalledWith({ teamId: TEAM_ID, nodeId: NODE_ID });
    expect(receipt).toMatchObject({ teamId: TEAM_ID, nodeId: NODE_ID, status: 'started' });
  });

  it('refuses recovery when the Relay has no active lead membership', async () => {
    const recovery: DistributedLocalLeadRecoveryPort = { reconnect: vi.fn() };
    await expect(
      new ReconnectDistributedLeadUseCase(createRelay(false, false), recovery).execute({
        teamId: TEAM_ID,
      })
    ).rejects.toThrow('does not have an active lead');
  });
});
