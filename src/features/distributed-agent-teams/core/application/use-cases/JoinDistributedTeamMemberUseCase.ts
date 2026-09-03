import type {
  JoinDistributedTeamMemberReceiptDto,
  JoinDistributedTeamMemberRequest,
} from '../../../contracts';
import type { DistributedRelayPort } from '../ports/DistributedRelayPort';

export class JoinDistributedTeamMemberUseCase {
  constructor(private readonly relay: DistributedRelayPort) {}

  async execute(
    request: JoinDistributedTeamMemberRequest
  ): Promise<JoinDistributedTeamMemberReceiptDto> {
    if (this.relay.insecureLanMode) {
      throw new Error('Changing distributed membership requires authenticated Relay credentials');
    }
    return await this.relay.joinTeamMember(request);
  }
}
