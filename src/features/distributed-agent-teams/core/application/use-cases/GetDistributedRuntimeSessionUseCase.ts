import type {
  DistributedRuntimeSessionDto,
  GetDistributedRuntimeSessionRequest,
} from '../../../contracts';
import type { DistributedRelayPort } from '../ports/DistributedRelayPort';

export class GetDistributedRuntimeSessionUseCase {
  constructor(private readonly relay: DistributedRelayPort) {}

  execute(request: GetDistributedRuntimeSessionRequest): Promise<DistributedRuntimeSessionDto> {
    return this.relay.getRuntimeSession(request);
  }
}
