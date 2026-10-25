import type { DistributedTopologyDto } from '../../../contracts';
import type { DistributedRelayPort } from '../ports/DistributedRelayPort';

export class GetDistributedTopologyUseCase {
  constructor(private readonly relay: DistributedRelayPort) {}

  async execute(): Promise<DistributedTopologyDto> {
    try {
      const [workers, membershipRoutes, teamSettings] = await Promise.all([
        this.relay.listWorkers(),
        this.relay.listMembershipRoutes(),
        this.relay.listTeamSettings(),
      ]);
      return {
        relayUrl: this.relay.relayUrl,
        insecureLanMode: this.relay.insecureLanMode,
        workers: [...workers],
        membershipRoutes: [...membershipRoutes],
        teamSettings: [...teamSettings],
        fetchedAt: new Date().toISOString(),
        degraded: false,
      };
    } catch (error) {
      return {
        relayUrl: this.relay.relayUrl,
        insecureLanMode: this.relay.insecureLanMode,
        workers: [],
        membershipRoutes: [],
        teamSettings: [],
        fetchedAt: new Date().toISOString(),
        degraded: true,
        warning: error instanceof Error ? error.message : 'Relay topology request failed',
      };
    }
  }
}
