import { TEAM_EXPORT_RUN, type TeamExportElectronApi, type TeamExportRequest } from '../contracts';

import type { IpcRenderer } from 'electron';

export function createTeamExportBridge(
  ipcRenderer: IpcRenderer
): TeamExportElectronApi['teamExport'] {
  return {
    run: (request: TeamExportRequest) => ipcRenderer.invoke(TEAM_EXPORT_RUN, request),
  };
}
