import { createLogger } from '@shared/utils/logger';

import {
  MATTER_APPLY_PROPOSAL,
  MATTER_CREATE,
  MATTER_GET,
  MATTER_GET_LINK_STATUS,
  MATTER_LINK_INITIALIZE,
  MATTER_LINK_REQUEST_PROPOSAL,
  MATTER_LINK_REQUEST_REFRESH,
  MATTER_LINK_TEAM,
  MATTER_REJECT_PROPOSAL,
  MATTER_REQUEST_REFRESH,
  MATTER_UNLINK_TEAM,
  MATTER_UPDATE,
  normalizeMatterChanges,
  type MatterEvidenceStatusDto,
  type MatterLinkOperationResultDto,
  type MatterRefreshResultDto,
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

function assertMatterId(matterId: unknown): string {
  if (typeof matterId !== 'string' || !matterId.trim()) {
    throw new Error('matterId is required');
  }
  return matterId.trim();
}

function optionalMatterId(matterId: unknown): string | undefined {
  return typeof matterId === 'string' && matterId.trim() ? matterId.trim() : undefined;
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
    MATTER_UPDATE,
    async (
      _event,
      teamName: unknown,
      matterId: unknown,
      changes: unknown
    ): Promise<MatterSnapshotDto> => {
      try {
        // Boundary normalization: only known sections in a valid shape pass.
        const normalized = normalizeMatterChanges(changes);
        return await feature.updateMatter(
          assertTeamName(teamName),
          assertMatterId(matterId),
          normalized
        );
      } catch (error) {
        logger.error('Failed to update matter', error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    MATTER_CREATE,
    async (_event, teamName: unknown, init: unknown): Promise<MatterSnapshotDto> => {
      try {
        const caption =
          init && typeof init === 'object' && 'caption' in init
            ? (init as { caption?: unknown }).caption
            : undefined;
        return await feature.createMatter(
          assertTeamName(teamName),
          typeof caption === 'string' && caption.trim() ? { caption: caption.trim() } : undefined
        );
      } catch (error) {
        logger.error('Failed to create matter', error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    MATTER_LINK_TEAM,
    async (_event, teamName: unknown, matterId: unknown): Promise<MatterSnapshotDto> => {
      try {
        return await feature.linkTeam(assertTeamName(teamName), assertMatterId(matterId));
      } catch (error) {
        logger.error('Failed to link matter to team', error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    MATTER_UNLINK_TEAM,
    async (_event, teamName: unknown, matterId: unknown): Promise<MatterSnapshotDto> => {
      try {
        return await feature.unlinkTeam(assertTeamName(teamName), assertMatterId(matterId));
      } catch (error) {
        logger.error('Failed to unlink matter from team', error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    MATTER_GET_LINK_STATUS,
    async (_event, teamName: unknown): Promise<MatterEvidenceStatusDto> => {
      try {
        return await feature.getLinkStatus(assertTeamName(teamName));
      } catch (error) {
        logger.error('Failed to get Link matter evidence status', error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    MATTER_LINK_INITIALIZE,
    async (_event, teamName: unknown): Promise<MatterLinkOperationResultDto> => {
      try {
        return await feature.initializeLink(assertTeamName(teamName));
      } catch (error) {
        logger.error('Failed to initialize Link matter evidence', error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    MATTER_LINK_REQUEST_REFRESH,
    async (_event, teamName: unknown): Promise<MatterLinkOperationResultDto> => {
      try {
        return await feature.requestLinkRefresh(assertTeamName(teamName));
      } catch (error) {
        logger.error('Failed to request Link matter evidence refresh', error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    MATTER_LINK_REQUEST_PROPOSAL,
    async (
      _event,
      teamName: unknown,
      matterId?: unknown
    ): Promise<MatterLinkOperationResultDto> => {
      try {
        return await feature.requestLinkProposal(
          assertTeamName(teamName),
          optionalMatterId(matterId)
        );
      } catch (error) {
        logger.error('Failed to request Link-backed matter proposal', error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    MATTER_REQUEST_REFRESH,
    async (_event, teamName: unknown, matterId?: unknown): Promise<MatterRefreshResultDto> => {
      try {
        return await feature.requestDashboardRefresh(
          assertTeamName(teamName),
          optionalMatterId(matterId)
        );
      } catch (error) {
        logger.error('Failed to request a matter dashboard refresh', error);
        throw error;
      }
    }
  );

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
  ipcMain.removeHandler(MATTER_UPDATE);
  ipcMain.removeHandler(MATTER_CREATE);
  ipcMain.removeHandler(MATTER_LINK_TEAM);
  ipcMain.removeHandler(MATTER_UNLINK_TEAM);
  ipcMain.removeHandler(MATTER_GET_LINK_STATUS);
  ipcMain.removeHandler(MATTER_LINK_INITIALIZE);
  ipcMain.removeHandler(MATTER_LINK_REQUEST_REFRESH);
  ipcMain.removeHandler(MATTER_LINK_REQUEST_PROPOSAL);
  ipcMain.removeHandler(MATTER_REQUEST_REFRESH);
  ipcMain.removeHandler(MATTER_APPLY_PROPOSAL);
  ipcMain.removeHandler(MATTER_REJECT_PROPOSAL);
}
