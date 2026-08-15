import type {
  CreateRemoteAssignmentRequest,
  DistributedWorkerDto,
  RemoteAssignmentReceiptDto,
} from '../../../contracts';

export interface DistributedRelayPort {
  readonly relayUrl: string;
  listWorkers(): Promise<readonly DistributedWorkerDto[]>;
  createRemoteAssignment(
    request: CreateRemoteAssignmentRequest
  ): Promise<RemoteAssignmentReceiptDto>;
}
