import {
  DISTRIBUTED_AGENT_TEAMS_CREATE_ASSIGNMENT,
  DISTRIBUTED_AGENT_TEAMS_GET_ASSIGNMENT_EVENTS,
  DISTRIBUTED_AGENT_TEAMS_GET_DEBUG_SNAPSHOT,
  DISTRIBUTED_AGENT_TEAMS_GET_RUNTIME_SESSION,
  DISTRIBUTED_AGENT_TEAMS_GET_TOPOLOGY,
  DISTRIBUTED_AGENT_TEAMS_JOIN_TEAM_MEMBER,
  DISTRIBUTED_AGENT_TEAMS_LEAVE_TEAM_MEMBER,
  DISTRIBUTED_AGENT_TEAMS_RECONNECT_LEAD,
  DISTRIBUTED_AGENT_TEAMS_SEND_RUNTIME_CONTROL,
  DISTRIBUTED_AGENT_TEAMS_START_TEAM,
  normalizeCreateRemoteAssignmentRequest,
  normalizeGetDistributedRuntimeSessionRequest,
  normalizeJoinDistributedTeamMemberRequest,
  normalizeLeaveDistributedTeamMemberRequest,
  normalizeReconnectDistributedLeadRequest,
  normalizeSendDistributedRuntimeControlRequest,
  normalizeStartDistributedTeamRequest,
} from '../../../../contracts';

import type { DistributedAgentTeamsFeatureFacade } from '../../../composition/createDistributedAgentTeamsFeature';
import type { IpcMain } from 'electron';

export const registerDistributedAgentTeamsIpc = (
  ipcMain: IpcMain,
  feature: DistributedAgentTeamsFeatureFacade
): void => {
  ipcMain.handle(DISTRIBUTED_AGENT_TEAMS_GET_TOPOLOGY, () => feature.getTopology());
  ipcMain.handle(DISTRIBUTED_AGENT_TEAMS_GET_ASSIGNMENT_EVENTS, () =>
    feature.getAssignmentEvents()
  );
  ipcMain.handle(DISTRIBUTED_AGENT_TEAMS_GET_DEBUG_SNAPSHOT, () => feature.getDebugSnapshot());
  ipcMain.handle(DISTRIBUTED_AGENT_TEAMS_GET_RUNTIME_SESSION, (_event, input: unknown) =>
    feature.getRuntimeSession(normalizeGetDistributedRuntimeSessionRequest(input))
  );
  ipcMain.handle(DISTRIBUTED_AGENT_TEAMS_SEND_RUNTIME_CONTROL, (_event, input: unknown) =>
    feature.sendRuntimeControl(normalizeSendDistributedRuntimeControlRequest(input))
  );
  ipcMain.handle(DISTRIBUTED_AGENT_TEAMS_CREATE_ASSIGNMENT, (_event, input: unknown) =>
    feature.createRemoteAssignment(normalizeCreateRemoteAssignmentRequest(input))
  );
  ipcMain.handle(DISTRIBUTED_AGENT_TEAMS_START_TEAM, (_event, input: unknown) =>
    feature.startTeam(normalizeStartDistributedTeamRequest(input))
  );
  ipcMain.handle(DISTRIBUTED_AGENT_TEAMS_RECONNECT_LEAD, (_event, input: unknown) =>
    feature.reconnectLead(normalizeReconnectDistributedLeadRequest(input))
  );
  ipcMain.handle(DISTRIBUTED_AGENT_TEAMS_JOIN_TEAM_MEMBER, (_event, input: unknown) =>
    feature.joinTeamMember(normalizeJoinDistributedTeamMemberRequest(input))
  );
  ipcMain.handle(DISTRIBUTED_AGENT_TEAMS_LEAVE_TEAM_MEMBER, (_event, input: unknown) =>
    feature.leaveTeamMember(normalizeLeaveDistributedTeamMemberRequest(input))
  );
};

export const removeDistributedAgentTeamsIpc = (ipcMain: IpcMain): void => {
  ipcMain.removeHandler(DISTRIBUTED_AGENT_TEAMS_GET_TOPOLOGY);
  ipcMain.removeHandler(DISTRIBUTED_AGENT_TEAMS_GET_ASSIGNMENT_EVENTS);
  ipcMain.removeHandler(DISTRIBUTED_AGENT_TEAMS_GET_DEBUG_SNAPSHOT);
  ipcMain.removeHandler(DISTRIBUTED_AGENT_TEAMS_GET_RUNTIME_SESSION);
  ipcMain.removeHandler(DISTRIBUTED_AGENT_TEAMS_SEND_RUNTIME_CONTROL);
  ipcMain.removeHandler(DISTRIBUTED_AGENT_TEAMS_CREATE_ASSIGNMENT);
  ipcMain.removeHandler(DISTRIBUTED_AGENT_TEAMS_START_TEAM);
  ipcMain.removeHandler(DISTRIBUTED_AGENT_TEAMS_RECONNECT_LEAD);
  ipcMain.removeHandler(DISTRIBUTED_AGENT_TEAMS_JOIN_TEAM_MEMBER);
  ipcMain.removeHandler(DISTRIBUTED_AGENT_TEAMS_LEAVE_TEAM_MEMBER);
};
