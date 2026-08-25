import type { DistributedTopologyDto } from '../../../contracts';
import type { DistributedRelayPort } from '../ports/DistributedRelayPort';

export class GetDistributedTopologyUseCase {
  constructor(private readonly relay: DistributedRelayPort) {}

  async execute(): Promise<DistributedTopologyDto> {
    try {
      return {
        relayUrl: this.relay.relayUrl,
        insecureLanMode: this.relay.insecureLanMode,
        workers: [...(await this.relay.listWorkers())],
        fetchedAt: new Date().toISOString(),
        degraded: false,
      };
    } catch (error) {
      return {
        relayUrl: this.relay.relayUrl,
        insecureLanMode: this.relay.insecureLanMode,
        workers: [],
        fetchedAt: new Date().toISOString(),
        degraded: true,
        warning: error instanceof Error ? error.message : 'Relay topology request failed',
      };
    }
  }
}
