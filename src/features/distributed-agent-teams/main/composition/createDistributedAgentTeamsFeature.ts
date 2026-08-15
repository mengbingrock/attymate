import { CreateRemoteAssignmentUseCase } from '../../core/application/use-cases/CreateRemoteAssignmentUseCase';
import { GetDistributedAssignmentEventsUseCase } from '../../core/application/use-cases/GetDistributedAssignmentEventsUseCase';
import { GetDistributedTopologyUseCase } from '../../core/application/use-cases/GetDistributedTopologyUseCase';
import { RelayHttpAdapter } from '../infrastructure/RelayHttpAdapter';

import type {
  CreateRemoteAssignmentRequest,
  DistributedAssignmentEventsDto,
  DistributedTopologyDto,
  RemoteAssignmentReceiptDto,
} from '../../contracts';

export interface DistributedAgentTeamsFeatureFacade {
  getTopology(): Promise<DistributedTopologyDto>;
  getAssignmentEvents(): Promise<DistributedAssignmentEventsDto>;
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
  const getAssignmentEvents = new GetDistributedAssignmentEventsUseCase(relay);
  const createAssignment = new CreateRemoteAssignmentUseCase(relay);
  return {
    getTopology: () => getTopology.execute(),
    getAssignmentEvents: () => getAssignmentEvents.execute(),
    createRemoteAssignment: (request) => createAssignment.execute(request),
  };
};
