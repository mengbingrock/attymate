import type {
  ReconnectDistributedLeadReceiptDto,
  ReconnectDistributedLeadRequest,
} from '../../../contracts';
import type { DistributedLocalLeadRecoveryPort } from '../ports/DistributedLocalLeadRecoveryPort';
import type { DistributedRelayPort } from '../ports/DistributedRelayPort';

export class ReconnectDistributedLeadUseCase {
  constructor(
    private readonly relay: DistributedRelayPort,
    private readonly localLeadRecovery: DistributedLocalLeadRecoveryPort
  ) {}

  async execute(
    request: ReconnectDistributedLeadRequest
  ): Promise<ReconnectDistributedLeadReceiptDto> {
    const [workers, membershipRoutes] = await Promise.all([
      this.relay.listWorkers(),
      this.relay.listMembershipRoutes(),
    ]);
    const lead = membershipRoutes.find(
      (route) =>
        route.teamId === request.teamId && route.status === 'active' && route.role === 'lead'
    );
    if (lead === undefined) {
      throw new Error('This distributed team does not have an active lead membership');
    }
    const requestedAt = new Date().toISOString();
    if (workers.some((worker) => worker.nodeId === lead.nodeId && worker.status === 'connected')) {
      return {
        teamId: request.teamId,
        nodeId: lead.nodeId,
        status: 'already-connected',
        requestedAt,
      };
    }
    const recovery = await this.localLeadRecovery.reconnect({
      teamId: request.teamId,
      nodeId: lead.nodeId,
    });
    return {
      teamId: request.teamId,
      nodeId: lead.nodeId,
      status: recovery.status,
      requestedAt,
    };
  }
}
