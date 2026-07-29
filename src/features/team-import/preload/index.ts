import {
  TEAM_IMPORT_CHOOSE_FOLDER_AND_PREVIEW,
  TEAM_IMPORT_CREATE_DRAFT,
  TEAM_IMPORT_JOB_PROGRESS,
  TEAM_IMPORT_SMART_PREVIEW,
} from '@features/team-import/contracts';

import type { TeamImportApi, TeamImportJobProgress } from '@features/team-import/contracts';
import type { IpcRenderer, IpcRendererEvent } from 'electron';

export function createTeamImportBridge(ipcRenderer: IpcRenderer): TeamImportApi {
  return {
    chooseFolderAndPreview: () => ipcRenderer.invoke(TEAM_IMPORT_CHOOSE_FOLDER_AND_PREVIEW),
    smartPreview: (request) => ipcRenderer.invoke(TEAM_IMPORT_SMART_PREVIEW, request),
    createDraft: (request) => ipcRenderer.invoke(TEAM_IMPORT_CREATE_DRAFT, request),
    onJobProgress: (listener) => {
      const handler = (_event: IpcRendererEvent, progress: TeamImportJobProgress): void => {
        listener(progress);
      };
      ipcRenderer.on(TEAM_IMPORT_JOB_PROGRESS, handler);
      return () => ipcRenderer.removeListener(TEAM_IMPORT_JOB_PROGRESS, handler);
    },
  };
}
