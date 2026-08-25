import type {
  CreateRemoteAssignmentRequest,
  DistributedAssignmentEventsDto,
  DistributedDebugSnapshotDto,
  DistributedRuntimeControlReceiptDto,
  DistributedRuntimeSessionDto,
  DistributedTopologyDto,
  GetDistributedRuntimeSessionRequest,
  RemoteAssignmentReceiptDto,
  SendDistributedRuntimeControlRequest,
  StartDistributedTeamReceiptDto,
  StartDistributedTeamRequest,
} from './dto';

export interface DistributedAgentTeamsElectronApi {
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
}
