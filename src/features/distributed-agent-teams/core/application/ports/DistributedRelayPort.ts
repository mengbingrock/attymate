import type {
  CreateRemoteAssignmentRequest,
  DistributedAssignmentEventDto,
  DistributedMembershipRouteDto,
  DistributedRelayCommandDto,
  DistributedRelayEventDto,
  DistributedRelayLeaseDto,
  DistributedRuntimeControlReceiptDto,
  DistributedRuntimeSessionDto,
  DistributedWorkerDto,
  GetDistributedRuntimeSessionRequest,
  JoinDistributedTeamMemberReceiptDto,
  JoinDistributedTeamMemberRequest,
  LeaveDistributedTeamMemberReceiptDto,
  LeaveDistributedTeamMemberRequest,
  RemoteAssignmentReceiptDto,
  SendDistributedRuntimeControlRequest,
} from '../../../contracts';

export interface DistributedRelayPort {
  readonly relayUrl: string;
  readonly insecureLanMode: boolean;
  listWorkers(): Promise<readonly DistributedWorkerDto[]>;
  listAssignmentEvents(): Promise<readonly DistributedAssignmentEventDto[]>;
  listCommands(): Promise<readonly DistributedRelayCommandDto[]>;
  listEvents(): Promise<readonly DistributedRelayEventDto[]>;
  listLeases(): Promise<readonly DistributedRelayLeaseDto[]>;
  listMembershipRoutes(): Promise<readonly DistributedMembershipRouteDto[]>;
  getRuntimeSession(
    request: GetDistributedRuntimeSessionRequest
  ): Promise<DistributedRuntimeSessionDto>;
  sendRuntimeControl(
    request: SendDistributedRuntimeControlRequest
  ): Promise<DistributedRuntimeControlReceiptDto>;
  createRemoteAssignment(
    request: CreateRemoteAssignmentRequest
  ): Promise<RemoteAssignmentReceiptDto>;
  acceptRemoteAssignment(input: {
    teamId: string;
    targetNodeId: string;
    assignmentId: string;
    expectedRevision: number;
  }): Promise<RemoteAssignmentReceiptDto>;
  joinTeamMember(
    request: JoinDistributedTeamMemberRequest
  ): Promise<JoinDistributedTeamMemberReceiptDto>;
  leaveTeamMember(
    request: LeaveDistributedTeamMemberRequest
  ): Promise<LeaveDistributedTeamMemberReceiptDto>;
}
