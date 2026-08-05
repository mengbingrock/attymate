import type { TeamImportPreview } from '@features/team-import/contracts';
import type { TeamProvisioningMemberInput } from '@shared/types/team';

export interface TeamImportDraftRepositoryPort {
  createDraft(
    teamName: string,
    preview: TeamImportPreview,
    lead: TeamProvisioningMemberInput
  ): Promise<void>;
}
