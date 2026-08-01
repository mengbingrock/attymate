import { createLogger } from '@shared/utils/logger';

import {
  MATTER_APPLY_PROPOSAL,
  MATTER_GET,
  MATTER_REJECT_PROPOSAL,
  type MatterSnapshotDto,
} from '../../../../contracts';

import type { MatterFeatureFacade } from '../../../composition/createMatterFeature';
import type { IpcMain } from 'electron';

const logger = createLogger('Feature:Matter:IPC');

function assertTeamName(teamName: unknown): string {
  if (typeof teamName !== 'string' || !teamName.trim()) {
    throw new Error('teamName is required');
  }
  return teamName.trim();
}

export function registerMatterIpc(ipcMain: IpcMain, feature: MatterFeatureFacade): void {
  ipcMain.handle(MATTER_GET, async (_event, teamName: unknown): Promise<MatterSnapshotDto> => {
    try {
      return await feature.getSnapshot(assertTeamName(teamName));
    } catch (error) {
      logger.error('Failed to get matter snapshot', error);
      throw error;
    }
  });

  ipcMain.handle(
    MATTER_APPLY_PROPOSAL,
    async (_event, teamName: unknown): Promise<MatterSnapshotDto> => {
      try {
        return await feature.applyProposal(assertTeamName(teamName));
      } catch (error) {
        logger.error('Failed to apply matter proposal', error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    MATTER_REJECT_PROPOSAL,
    async (_event, teamName: unknown, reason?: unknown): Promise<MatterSnapshotDto> => {
      try {
        return await feature.rejectProposal(
          assertTeamName(teamName),
          typeof reason === 'string' && reason.trim() ? reason.trim() : undefined
        );
      } catch (error) {
        logger.error('Failed to reject matter proposal', error);
        throw error;
      }
    }
  );
}

export function removeMatterIpc(ipcMain: IpcMain): void {
  ipcMain.removeHandler(MATTER_GET);
  ipcMain.removeHandler(MATTER_APPLY_PROPOSAL);
  ipcMain.removeHandler(MATTER_REJECT_PROPOSAL);
}
