import type { DistributedAssignmentEventsDto } from '../../../contracts';
import type { DistributedRelayPort } from '../ports/DistributedRelayPort';

export class GetDistributedAssignmentEventsUseCase {
  constructor(private readonly relay: DistributedRelayPort) {}

  async execute(): Promise<DistributedAssignmentEventsDto> {
    try {
      return {
        events: [...(await this.relay.listAssignmentEvents())],
        fetchedAt: new Date().toISOString(),
        degraded: false,
      };
    } catch (error) {
      return {
        events: [],
        fetchedAt: new Date().toISOString(),
        degraded: true,
        warning: error instanceof Error ? error.message : 'Relay assignment event request failed',
      };
    }
  }
}
