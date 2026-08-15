import type {
  CreateRemoteAssignmentRequest,
  DistributedTopologyDto,
  RemoteAssignmentReceiptDto,
} from './dto';

export interface DistributedAgentTeamsElectronApi {
  getTopology(): Promise<DistributedTopologyDto>;
  createRemoteAssignment(
    request: CreateRemoteAssignmentRequest
  ): Promise<RemoteAssignmentReceiptDto>;
}
