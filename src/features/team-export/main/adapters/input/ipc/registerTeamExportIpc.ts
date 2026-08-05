import { createLogger } from '@shared/utils/logger';

import {
  TEAM_EXPORT_RUN,
  type TeamExportRequest,
  type TeamExportResult,
} from '../../../../contracts';

import type { TeamExportFeatureFacade } from '../../../composition/createTeamExportFeature';
import type { IpcMain } from 'electron';

const logger = createLogger('Feature:TeamExport:IPC');

function parseRequest(value: unknown): TeamExportRequest {
  if (!value || typeof value !== 'object') throw new Error('teamName is required');
  const request = value as Record<string, unknown>;
  const teamName = typeof request.teamName === 'string' ? request.teamName.trim() : '';
  if (!teamName) throw new Error('teamName is required');
  return {
    teamName,
    ...(typeof request.destinationPath === 'string' && request.destinationPath.trim()
      ? { destinationPath: request.destinationPath.trim() }
      : {}),
    ...(request.overwrite === true ? { overwrite: true } : {}),
  };
}

export function registerTeamExportIpc(ipcMain: IpcMain, feature: TeamExportFeatureFacade): void {
  ipcMain.handle(
    TEAM_EXPORT_RUN,
    async (_event, request: unknown): Promise<TeamExportResult | null> => {
      try {
        return await feature.exportTeam(parseRequest(request));
      } catch (error) {
        logger.error('Failed to export team', error);
        throw error;
      }
    }
  );
}

export function removeTeamExportIpc(ipcMain: IpcMain): void {
  ipcMain.removeHandler(TEAM_EXPORT_RUN);
}
