import type {
  UpdateDistributedTeamSettingsReceiptDto,
  UpdateDistributedTeamSettingsRequest,
} from '../../../contracts';
import type { DistributedRelayPort } from '../ports/DistributedRelayPort';

export class UpdateDistributedTeamSettingsUseCase {
  constructor(private readonly relay: DistributedRelayPort) {}

  async execute(
    request: UpdateDistributedTeamSettingsRequest
  ): Promise<UpdateDistributedTeamSettingsReceiptDto> {
    if (this.relay.insecureLanMode) {
      throw new Error('Changing team coordination requires authenticated Relay credentials');
    }
    return await this.relay.updateTeamSettings(request);
  }
}
