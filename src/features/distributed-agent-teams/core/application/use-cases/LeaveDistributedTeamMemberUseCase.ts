import type {
  LeaveDistributedTeamMemberReceiptDto,
  LeaveDistributedTeamMemberRequest,
} from '../../../contracts';
import type { DistributedRelayPort } from '../ports/DistributedRelayPort';

export class LeaveDistributedTeamMemberUseCase {
  constructor(private readonly relay: DistributedRelayPort) {}

  async execute(
    request: LeaveDistributedTeamMemberRequest
  ): Promise<LeaveDistributedTeamMemberReceiptDto> {
    if (this.relay.insecureLanMode) {
      throw new Error('Changing distributed membership requires authenticated Relay credentials');
    }
    return await this.relay.leaveTeamMember(request);
  }
}
