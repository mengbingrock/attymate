import { CreateRemoteAssignmentUseCase } from '../../core/application/use-cases/CreateRemoteAssignmentUseCase';
import { GetDistributedTopologyUseCase } from '../../core/application/use-cases/GetDistributedTopologyUseCase';
import { RelayHttpAdapter } from '../infrastructure/RelayHttpAdapter';

import type {
  CreateRemoteAssignmentRequest,
  DistributedTopologyDto,
  RemoteAssignmentReceiptDto,
} from '../../contracts';

export interface DistributedAgentTeamsFeatureFacade {
  getTopology(): Promise<DistributedTopologyDto>;
  createRemoteAssignment(
    request: CreateRemoteAssignmentRequest
  ): Promise<RemoteAssignmentReceiptDto>;
}

export const createDistributedAgentTeamsFeature = (input: {
  readonly relayUrl: string;
  readonly fetchImpl?: typeof fetch;
}): DistributedAgentTeamsFeatureFacade => {
  const relay = new RelayHttpAdapter(input.relayUrl, input.fetchImpl);
  const getTopology = new GetDistributedTopologyUseCase(relay);
  const createAssignment = new CreateRemoteAssignmentUseCase(relay);
  return {
    getTopology: () => getTopology.execute(),
    createRemoteAssignment: (request) => createAssignment.execute(request),
  };
};
