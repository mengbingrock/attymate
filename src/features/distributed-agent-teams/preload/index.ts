import {
  DISTRIBUTED_AGENT_TEAMS_CREATE_ASSIGNMENT,
  DISTRIBUTED_AGENT_TEAMS_GET_TOPOLOGY,
  type DistributedAgentTeamsElectronApi,
} from '../contracts';

import type { IpcRenderer } from 'electron';

export const createDistributedAgentTeamsBridge = (
  ipcRenderer: IpcRenderer
): DistributedAgentTeamsElectronApi => ({
  getTopology: () => ipcRenderer.invoke(DISTRIBUTED_AGENT_TEAMS_GET_TOPOLOGY),
  createRemoteAssignment: (request) =>
    ipcRenderer.invoke(DISTRIBUTED_AGENT_TEAMS_CREATE_ASSIGNMENT, request),
});
