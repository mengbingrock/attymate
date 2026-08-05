import {
  TEAM_IMPORT_CHOOSE_FOLDER_AND_PREVIEW,
  TEAM_IMPORT_CREATE_DRAFT,
  TEAM_IMPORT_JOB_PROGRESS,
  TEAM_IMPORT_SMART_PREVIEW,
} from '@features/team-import/contracts';
import { createLogger } from '@shared/utils/logger';

import type { TeamImportFeatureFacade } from '../../../composition/createTeamImportFeature';
import type {
  CreateTeamImportDraftRequest,
  TeamImportJobProgress,
  TeamImportSourceRequest,
} from '@features/team-import/contracts';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';

const logger = createLogger('Feature:TeamImport:IPC');

function parseCreateDraftRequest(value: unknown): CreateTeamImportDraftRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid team import request.');
  }
  const request = value as Record<string, unknown>;
  if (
    typeof request.reviewId !== 'string' ||
    typeof request.teamName !== 'string' ||
    typeof request.leadName !== 'string'
  ) {
    throw new Error('Import review, team name, and lead are required.');
  }
  return {
    reviewId: request.reviewId,
    teamName: request.teamName,
    leadName: request.leadName,
  };
}

function parseSourceRequest(value: unknown): TeamImportSourceRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid team import source request.');
  }
  const request = value as Record<string, unknown>;
  if (request.kind === 'folder') {
    return {
      kind: 'folder',
      smart: request.smart === true,
      ...(typeof request.folderPath === 'string' && request.folderPath.trim()
        ? { folderPath: request.folderPath }
        : {}),
    };
  }
  if (request.kind === 'url' && typeof request.url === 'string') {
    return { kind: 'url', url: request.url };
  }
  throw new Error('Invalid team import source request.');
}

export function registerTeamImportIpc(ipcMain: IpcMain, feature: TeamImportFeatureFacade): void {
  ipcMain.handle(TEAM_IMPORT_CHOOSE_FOLDER_AND_PREVIEW, async () => {
    try {
      return await feature.chooseFolderAndPreview();
    } catch (error) {
      logger.error('Failed to inspect selected team folder', error);
      throw error;
    }
  });
  ipcMain.handle(TEAM_IMPORT_SMART_PREVIEW, async (event: IpcMainInvokeEvent, request: unknown) => {
    try {
      const parsedRequest = parseSourceRequest(request);
      return await feature.smartPreview(parsedRequest, {
        report: (progress: TeamImportJobProgress) => {
          if (event.sender.isDestroyed()) return;
          event.sender.send(TEAM_IMPORT_JOB_PROGRESS, progress);
        },
      });
    } catch (error) {
      logger.error('Failed to build smart team import preview', error);
      throw error;
    }
  });
  ipcMain.handle(TEAM_IMPORT_CREATE_DRAFT, async (_event, request: unknown) => {
    try {
      const parsedRequest = parseCreateDraftRequest(request);
      return await feature.createDraft(parsedRequest);
    } catch (error) {
      logger.error('Failed to create imported team draft', error);
      throw error;
    }
  });
}

export function removeTeamImportIpc(ipcMain: IpcMain): void {
  ipcMain.removeHandler(TEAM_IMPORT_CHOOSE_FOLDER_AND_PREVIEW);
  ipcMain.removeHandler(TEAM_IMPORT_SMART_PREVIEW);
  ipcMain.removeHandler(TEAM_IMPORT_CREATE_DRAFT);
}
