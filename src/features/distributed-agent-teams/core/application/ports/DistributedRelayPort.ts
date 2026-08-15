import type {
  CreateRemoteAssignmentRequest,
  DistributedAssignmentEventDto,
  DistributedWorkerDto,
  RemoteAssignmentReceiptDto,
} from '../../../contracts';

export interface DistributedRelayPort {
  readonly relayUrl: string;
  listWorkers(): Promise<readonly DistributedWorkerDto[]>;
  listAssignmentEvents(): Promise<readonly DistributedAssignmentEventDto[]>;
  createRemoteAssignment(
    request: CreateRemoteAssignmentRequest
  ): Promise<RemoteAssignmentReceiptDto>;
}
