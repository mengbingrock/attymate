import type {
  CreateRemoteAssignmentRequest,
  DistributedAssignmentEventsDto,
  DistributedTopologyDto,
  RemoteAssignmentReceiptDto,
} from './dto';

export interface DistributedAgentTeamsElectronApi {
  getTopology(): Promise<DistributedTopologyDto>;
  getAssignmentEvents(): Promise<DistributedAssignmentEventsDto>;
  createRemoteAssignment(
    request: CreateRemoteAssignmentRequest
  ): Promise<RemoteAssignmentReceiptDto>;
}
