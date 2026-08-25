import type {
  DistributedRuntimeControlReceiptDto,
  SendDistributedRuntimeControlRequest,
} from '../../../contracts';
import type { DistributedRelayPort } from '../ports/DistributedRelayPort';

export class SendDistributedRuntimeControlUseCase {
  constructor(private readonly relay: DistributedRelayPort) {}

  execute(
    request: SendDistributedRuntimeControlRequest
  ): Promise<DistributedRuntimeControlReceiptDto> {
    return this.relay.sendRuntimeControl(request);
  }
}
