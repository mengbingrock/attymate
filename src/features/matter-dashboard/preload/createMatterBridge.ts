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
  type MatterChanges,
  type MatterElectronApi,
  MATTERS_CHANGED_EVENT,
} from '../contracts';

import type { IpcRenderer } from 'electron';

export function createMatterBridge(ipcRenderer: IpcRenderer): MatterElectronApi['matter'] {
  return {
    get: (teamName: string) => ipcRenderer.invoke(MATTER_GET, teamName),
    update: (teamName: string, matterId: string, changes: MatterChanges) =>
      ipcRenderer.invoke(MATTER_UPDATE, teamName, matterId, changes),
    create: (teamName: string, init?: { caption?: string }) =>
      ipcRenderer.invoke(MATTER_CREATE, teamName, init),
    linkTeam: (teamName: string, matterId: string) =>
      ipcRenderer.invoke(MATTER_LINK_TEAM, teamName, matterId),
    unlinkTeam: (teamName: string, matterId: string) =>
      ipcRenderer.invoke(MATTER_UNLINK_TEAM, teamName, matterId),
    getLinkStatus: (teamName: string) => ipcRenderer.invoke(MATTER_GET_LINK_STATUS, teamName),
    initializeLink: (teamName: string) => ipcRenderer.invoke(MATTER_LINK_INITIALIZE, teamName),
    requestLinkRefresh: (teamName: string) =>
      ipcRenderer.invoke(MATTER_LINK_REQUEST_REFRESH, teamName),
    requestLinkProposal: (teamName: string, matterId?: string) =>
      ipcRenderer.invoke(MATTER_LINK_REQUEST_PROPOSAL, teamName, matterId),
    requestRefresh: (teamName: string, matterId?: string) =>
      ipcRenderer.invoke(MATTER_REQUEST_REFRESH, teamName, matterId),
    applyProposal: (teamName: string) => ipcRenderer.invoke(MATTER_APPLY_PROPOSAL, teamName),
    rejectProposal: (teamName: string, reason?: string) =>
      ipcRenderer.invoke(MATTER_REJECT_PROPOSAL, teamName, reason),
    onMattersChanged: (listener: () => void) => {
      const wrapped = () => listener();
      ipcRenderer.on(MATTERS_CHANGED_EVENT, wrapped);
      return () => {
        ipcRenderer.removeListener(MATTERS_CHANGED_EVENT, wrapped);
      };
    },
  };
}
