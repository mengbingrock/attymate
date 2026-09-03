import { CreateRemoteAssignmentUseCase } from '../../core/application/use-cases/CreateRemoteAssignmentUseCase';
import { GetDistributedAssignmentEventsUseCase } from '../../core/application/use-cases/GetDistributedAssignmentEventsUseCase';
import { GetDistributedDebugSnapshotUseCase } from '../../core/application/use-cases/GetDistributedDebugSnapshotUseCase';
import { GetDistributedRuntimeSessionUseCase } from '../../core/application/use-cases/GetDistributedRuntimeSessionUseCase';
import { GetDistributedTopologyUseCase } from '../../core/application/use-cases/GetDistributedTopologyUseCase';
import { JoinDistributedTeamMemberUseCase } from '../../core/application/use-cases/JoinDistributedTeamMemberUseCase';
import { LeaveDistributedTeamMemberUseCase } from '../../core/application/use-cases/LeaveDistributedTeamMemberUseCase';
import { ReconnectDistributedLeadUseCase } from '../../core/application/use-cases/ReconnectDistributedLeadUseCase';
import { SendDistributedRuntimeControlUseCase } from '../../core/application/use-cases/SendDistributedRuntimeControlUseCase';
import { StartDistributedTeamUseCase } from '../../core/application/use-cases/StartDistributedTeamUseCase';
import { PersistentLocalLeadRecoveryAdapter } from '../infrastructure/PersistentLocalLeadRecoveryAdapter';
import { RelayHttpAdapter } from '../infrastructure/RelayHttpAdapter';

import type {
  CreateRemoteAssignmentRequest,
  DistributedAssignmentEventsDto,
  DistributedDebugSnapshotDto,
  DistributedRuntimeControlReceiptDto,
  DistributedRuntimeSessionDto,
  DistributedTopologyDto,
  GetDistributedRuntimeSessionRequest,
  JoinDistributedTeamMemberReceiptDto,
  JoinDistributedTeamMemberRequest,
  LeaveDistributedTeamMemberReceiptDto,
  LeaveDistributedTeamMemberRequest,
  ReconnectDistributedLeadReceiptDto,
  ReconnectDistributedLeadRequest,
  RemoteAssignmentReceiptDto,
  SendDistributedRuntimeControlRequest,
  StartDistributedTeamReceiptDto,
  StartDistributedTeamRequest,
} from '../../contracts';
import type { DistributedLocalLeadRecoveryPort } from '../../core/application/ports/DistributedLocalLeadRecoveryPort';

export interface DistributedAgentTeamsFeatureFacade {
  getTopology(): Promise<DistributedTopologyDto>;
  getAssignmentEvents(): Promise<DistributedAssignmentEventsDto>;
  getDebugSnapshot(): Promise<DistributedDebugSnapshotDto>;
  getRuntimeSession(
    request: GetDistributedRuntimeSessionRequest
  ): Promise<DistributedRuntimeSessionDto>;
  sendRuntimeControl(
    request: SendDistributedRuntimeControlRequest
  ): Promise<DistributedRuntimeControlReceiptDto>;
  createRemoteAssignment(
    request: CreateRemoteAssignmentRequest
  ): Promise<RemoteAssignmentReceiptDto>;
  startTeam(request: StartDistributedTeamRequest): Promise<StartDistributedTeamReceiptDto>;
  reconnectLead(
    request: ReconnectDistributedLeadRequest
  ): Promise<ReconnectDistributedLeadReceiptDto>;
  joinTeamMember(
    request: JoinDistributedTeamMemberRequest
  ): Promise<JoinDistributedTeamMemberReceiptDto>;
  leaveTeamMember(
    request: LeaveDistributedTeamMemberRequest
  ): Promise<LeaveDistributedTeamMemberReceiptDto>;
}

export const createDistributedAgentTeamsFeature = (input: {
  readonly relayUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly managerToken?: string;
  readonly localLeadRecovery?: DistributedLocalLeadRecoveryPort;
}): DistributedAgentTeamsFeatureFacade => {
  const relay = new RelayHttpAdapter(input.relayUrl, input.fetchImpl, input.managerToken);
  const getTopology = new GetDistributedTopologyUseCase(relay);
  const getAssignmentEvents = new GetDistributedAssignmentEventsUseCase(relay);
  const getDebugSnapshot = new GetDistributedDebugSnapshotUseCase(relay);
  const getRuntimeSession = new GetDistributedRuntimeSessionUseCase(relay);
  const sendRuntimeControl = new SendDistributedRuntimeControlUseCase(relay);
  const createAssignment = new CreateRemoteAssignmentUseCase(relay);
  const startTeam = new StartDistributedTeamUseCase(relay);
  const reconnectLead = new ReconnectDistributedLeadUseCase(
    relay,
    input.localLeadRecovery ?? new PersistentLocalLeadRecoveryAdapter()
  );
  const joinTeamMember = new JoinDistributedTeamMemberUseCase(relay);
  const leaveTeamMember = new LeaveDistributedTeamMemberUseCase(relay);
  return {
    getTopology: () => getTopology.execute(),
    getAssignmentEvents: () => getAssignmentEvents.execute(),
    getDebugSnapshot: () => getDebugSnapshot.execute(),
    getRuntimeSession: (request) => getRuntimeSession.execute(request),
    sendRuntimeControl: (request) => sendRuntimeControl.execute(request),
    createRemoteAssignment: (request) => createAssignment.execute(request),
    startTeam: (request) => startTeam.execute(request),
    reconnectLead: (request) => reconnectLead.execute(request),
    joinTeamMember: (request) => joinTeamMember.execute(request),
    leaveTeamMember: (request) => leaveTeamMember.execute(request),
  };
};
