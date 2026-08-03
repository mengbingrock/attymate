import {
  MATTER_APPLY_PROPOSAL,
  MATTER_GET,
  MATTER_GET_LINK_STATUS,
  MATTER_LINK_INITIALIZE,
  MATTER_LINK_REQUEST_PROPOSAL,
  MATTER_LINK_REQUEST_REFRESH,
  MATTER_REJECT_PROPOSAL,
  type MatterElectronApi,
} from '../contracts';

import type { IpcRenderer } from 'electron';

export function createMatterBridge(ipcRenderer: IpcRenderer): MatterElectronApi['matter'] {
  return {
    get: (teamName: string) => ipcRenderer.invoke(MATTER_GET, teamName),
    getLinkStatus: (teamName: string) => ipcRenderer.invoke(MATTER_GET_LINK_STATUS, teamName),
    initializeLink: (teamName: string) => ipcRenderer.invoke(MATTER_LINK_INITIALIZE, teamName),
    requestLinkRefresh: (teamName: string) =>
      ipcRenderer.invoke(MATTER_LINK_REQUEST_REFRESH, teamName),
    requestLinkProposal: (teamName: string) =>
      ipcRenderer.invoke(MATTER_LINK_REQUEST_PROPOSAL, teamName),
    applyProposal: (teamName: string) => ipcRenderer.invoke(MATTER_APPLY_PROPOSAL, teamName),
    rejectProposal: (teamName: string, reason?: string) =>
      ipcRenderer.invoke(MATTER_REJECT_PROPOSAL, teamName, reason),
  };
}
