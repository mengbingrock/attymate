import {
  DISTRIBUTED_AGENT_TEAMS_CREATE_ASSIGNMENT,
  DISTRIBUTED_AGENT_TEAMS_GET_ASSIGNMENT_EVENTS,
  DISTRIBUTED_AGENT_TEAMS_GET_DEBUG_SNAPSHOT,
  DISTRIBUTED_AGENT_TEAMS_GET_RUNTIME_SESSION,
  DISTRIBUTED_AGENT_TEAMS_GET_TOPOLOGY,
  DISTRIBUTED_AGENT_TEAMS_SEND_RUNTIME_CONTROL,
  DISTRIBUTED_AGENT_TEAMS_START_TEAM,
} from '../contracts/channels';

import type { DistributedAgentTeamsElectronApi } from '../contracts/api';
import type { IpcRenderer } from 'electron';

export const createDistributedAgentTeamsBridge = (
  ipcRenderer: IpcRenderer
): DistributedAgentTeamsElectronApi => ({
  getTopology: () => ipcRenderer.invoke(DISTRIBUTED_AGENT_TEAMS_GET_TOPOLOGY),
  getAssignmentEvents: () => ipcRenderer.invoke(DISTRIBUTED_AGENT_TEAMS_GET_ASSIGNMENT_EVENTS),
  getDebugSnapshot: () => ipcRenderer.invoke(DISTRIBUTED_AGENT_TEAMS_GET_DEBUG_SNAPSHOT),
  getRuntimeSession: (request) =>
    ipcRenderer.invoke(DISTRIBUTED_AGENT_TEAMS_GET_RUNTIME_SESSION, request),
  sendRuntimeControl: (request) =>
    ipcRenderer.invoke(DISTRIBUTED_AGENT_TEAMS_SEND_RUNTIME_CONTROL, request),
  createRemoteAssignment: (request) =>
    ipcRenderer.invoke(DISTRIBUTED_AGENT_TEAMS_CREATE_ASSIGNMENT, request),
  startTeam: (request) => ipcRenderer.invoke(DISTRIBUTED_AGENT_TEAMS_START_TEAM, request),
});
