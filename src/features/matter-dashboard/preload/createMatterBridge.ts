import {
  MATTER_APPLY_PROPOSAL,
  MATTER_GET,
  MATTER_REJECT_PROPOSAL,
  type MatterElectronApi,
} from '../contracts';

import type { IpcRenderer } from 'electron';

export function createMatterBridge(ipcRenderer: IpcRenderer): MatterElectronApi['matter'] {
  return {
    get: (teamName: string) => ipcRenderer.invoke(MATTER_GET, teamName),
    applyProposal: (teamName: string) => ipcRenderer.invoke(MATTER_APPLY_PROPOSAL, teamName),
    rejectProposal: (teamName: string, reason?: string) =>
      ipcRenderer.invoke(MATTER_REJECT_PROPOSAL, teamName, reason),
  };
}
