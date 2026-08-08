import { describe, expect, it, vi } from 'vitest';

import {
  MATTER_GET_LINK_STATUS,
  MATTER_LINK_INITIALIZE,
  MATTER_LINK_REQUEST_PROPOSAL,
  MATTER_LINK_REQUEST_REFRESH,
} from '@features/matter-dashboard/contracts';
import {
  registerMatterIpc,
  removeMatterIpc,
} from '@features/matter-dashboard/main/adapters/input/ipc/registerMatterIpc';

import type { MatterFeatureFacade } from '@features/matter-dashboard/main';
import type { IpcMain } from 'electron';

vi.mock('@shared/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('matter Link status IPC', () => {
  it('validates and forwards the team name, then removes the handler', async () => {
    const handlers = new Map<string, (event: unknown, teamName: unknown) => Promise<unknown>>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler) => handlers.set(channel, handler)),
      removeHandler: vi.fn(),
    } as unknown as IpcMain;
    const getLinkStatus = vi.fn(() => Promise.resolve({ state: 'ready' }));
    const feature = { getLinkStatus } as unknown as MatterFeatureFacade;
    registerMatterIpc(ipcMain, feature);

    await handlers.get(MATTER_GET_LINK_STATUS)?.({}, ' case-team ');

    expect(getLinkStatus).toHaveBeenCalledWith('case-team');
    removeMatterIpc(ipcMain);
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(MATTER_GET_LINK_STATUS);
  });

  it('rejects an empty team name before calling the feature', async () => {
    const handlers = new Map<string, (event: unknown, teamName: unknown) => Promise<unknown>>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler) => handlers.set(channel, handler)),
      removeHandler: vi.fn(),
    } as unknown as IpcMain;
    const getLinkStatus = vi.fn();
    registerMatterIpc(ipcMain, { getLinkStatus } as unknown as MatterFeatureFacade);

    await expect(handlers.get(MATTER_GET_LINK_STATUS)?.({}, '  ')).rejects.toThrow(
      'teamName is required'
    );
    expect(getLinkStatus).not.toHaveBeenCalled();
  });

  it('forwards all Link write/request operations through dedicated channels', async () => {
    const handlers = new Map<string, (event: unknown, teamName: unknown) => Promise<unknown>>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler) => handlers.set(channel, handler)),
      removeHandler: vi.fn(),
    } as unknown as IpcMain;
    const feature = {
      initializeLink: vi.fn(() => Promise.resolve({ operation: 'initialize' })),
      requestLinkRefresh: vi.fn(() => Promise.resolve({ operation: 'refresh-request' })),
      requestLinkProposal: vi.fn(() => Promise.resolve({ operation: 'proposal-request' })),
    } as unknown as MatterFeatureFacade;
    registerMatterIpc(ipcMain, feature);

    await handlers.get(MATTER_LINK_INITIALIZE)?.({}, 'case-team');
    await handlers.get(MATTER_LINK_REQUEST_REFRESH)?.({}, 'case-team');
    await handlers.get(MATTER_LINK_REQUEST_PROPOSAL)?.({}, 'case-team');

    expect(feature.initializeLink).toHaveBeenCalledWith('case-team');
    expect(feature.requestLinkRefresh).toHaveBeenCalledWith('case-team');
    expect(feature.requestLinkProposal).toHaveBeenCalledWith('case-team', undefined);
  });
});
