import {
  DISTRIBUTED_AGENT_TEAMS_CREATE_ASSIGNMENT,
  DISTRIBUTED_AGENT_TEAMS_GET_TOPOLOGY,
} from '@features/distributed-agent-teams/contracts';
import {
  registerDistributedAgentTeamsIpc,
  removeDistributedAgentTeamsIpc,
} from '@features/distributed-agent-teams/main';
import { describe, expect, it, vi } from 'vitest';

import type { DistributedAgentTeamsFeatureFacade } from '@features/distributed-agent-teams/main';
import type { IpcMain } from 'electron';

const NODE_ID = '11111111-1111-4111-8111-111111111111';

type IpcHandler = (event: unknown, input?: unknown) => unknown;

const createHarness = () => {
  const handlers = new Map<string, IpcHandler>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
  };
  const feature: DistributedAgentTeamsFeatureFacade = {
    getTopology: vi.fn(async () => ({
      relayUrl: 'http://127.0.0.1:43170',
      insecureLanMode: true as const,
      workers: [],
      fetchedAt: '2026-08-14T10:00:00.000Z',
      degraded: false,
    })),
    createRemoteAssignment: vi.fn(async (request) => ({
      commandId: '22222222-2222-4222-8222-222222222222',
      targetNodeId: request.targetNodeId,
      cursor: 1,
      status: 'pending' as const,
      createdAt: '2026-08-14T10:00:00.000Z',
    })),
  };
  return { feature, handlers, ipcMain: ipcMain as unknown as IpcMain };
};

describe('distributed Agent Teams IPC', () => {
  it('registers topology and assignment handlers with boundary normalization', async () => {
    const { feature, handlers, ipcMain } = createHarness();
    registerDistributedAgentTeamsIpc(ipcMain, feature);

    await expect(
      handlers.get(DISTRIBUTED_AGENT_TEAMS_GET_TOPOLOGY)?.({})
    ).resolves.toMatchObject({ degraded: false });
    await expect(
      handlers.get(DISTRIBUTED_AGENT_TEAMS_CREATE_ASSIGNMENT)?.(
        {},
        { targetNodeId: NODE_ID.toUpperCase(), title: '  Remote review  ' }
      )
    ).resolves.toMatchObject({ targetNodeId: NODE_ID });
    expect(feature.createRemoteAssignment).toHaveBeenCalledWith({
      targetNodeId: NODE_ID,
      title: 'Remote review',
    });
  });

  it('rejects malformed renderer input before invoking the feature', () => {
    const { feature, handlers, ipcMain } = createHarness();
    registerDistributedAgentTeamsIpc(ipcMain, feature);

    expect(() =>
      handlers
        .get(DISTRIBUTED_AGENT_TEAMS_CREATE_ASSIGNMENT)?.({}, { targetNodeId: '../x', title: '' })
    ).toThrow();
    expect(feature.createRemoteAssignment).not.toHaveBeenCalled();
  });

  it('removes only its two handlers', () => {
    const { feature, handlers, ipcMain } = createHarness();
    registerDistributedAgentTeamsIpc(ipcMain, feature);
    handlers.set('unrelated', vi.fn());

    removeDistributedAgentTeamsIpc(ipcMain);

    expect([...handlers.keys()]).toEqual(['unrelated']);
  });
});
