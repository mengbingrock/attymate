import type { DistributedDebugSnapshotDto } from '../../../contracts';
import type { DistributedRelayPort } from '../ports/DistributedRelayPort';

export class GetDistributedDebugSnapshotUseCase {
  constructor(private readonly relay: DistributedRelayPort) {}

  async execute(): Promise<DistributedDebugSnapshotDto> {
    try {
      const [commands, events, leases, membershipRoutes] = await Promise.all([
        this.relay.listCommands(),
        this.relay.listEvents(),
        this.relay.listLeases(),
        this.relay.listMembershipRoutes(),
      ]);
      return {
        relayUrl: this.relay.relayUrl,
        commands: [...commands],
        events: [...events],
        leases: [...leases],
        membershipRoutes: [...membershipRoutes],
        fetchedAt: new Date().toISOString(),
        degraded: false,
      };
    } catch (error) {
      return {
        relayUrl: this.relay.relayUrl,
        commands: [],
        events: [],
        leases: [],
        membershipRoutes: [],
        fetchedAt: new Date().toISOString(),
        degraded: true,
        warning: error instanceof Error ? error.message : 'Relay debug snapshot request failed',
      };
    }
  }
}
