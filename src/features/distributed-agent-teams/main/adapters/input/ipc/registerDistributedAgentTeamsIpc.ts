import {
  DISTRIBUTED_AGENT_TEAMS_CREATE_ASSIGNMENT,
  DISTRIBUTED_AGENT_TEAMS_GET_ASSIGNMENT_EVENTS,
  DISTRIBUTED_AGENT_TEAMS_GET_TOPOLOGY,
  normalizeCreateRemoteAssignmentRequest,
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
  ipcMain.handle(DISTRIBUTED_AGENT_TEAMS_CREATE_ASSIGNMENT, (_event, input: unknown) =>
    feature.createRemoteAssignment(normalizeCreateRemoteAssignmentRequest(input))
  );
};

export const removeDistributedAgentTeamsIpc = (ipcMain: IpcMain): void => {
  ipcMain.removeHandler(DISTRIBUTED_AGENT_TEAMS_GET_TOPOLOGY);
  ipcMain.removeHandler(DISTRIBUTED_AGENT_TEAMS_GET_ASSIGNMENT_EVENTS);
  ipcMain.removeHandler(DISTRIBUTED_AGENT_TEAMS_CREATE_ASSIGNMENT);
};
