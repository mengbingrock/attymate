import type { CreateRemoteAssignmentRequest, RemoteAssignmentReceiptDto } from '../../../contracts';
import type { DistributedRelayPort } from '../ports/DistributedRelayPort';

export class CreateRemoteAssignmentUseCase {
  constructor(private readonly relay: DistributedRelayPort) {}

  execute(request: CreateRemoteAssignmentRequest): Promise<RemoteAssignmentReceiptDto> {
    return this.relay.createRemoteAssignment(request);
  }
}
