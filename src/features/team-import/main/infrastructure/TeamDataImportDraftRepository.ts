import type { TeamImportDraftRepositoryPort } from '../../core/application/ports/TeamImportDraftRepositoryPort';
import type { TeamImportPreview } from '@features/team-import/contracts';
import type { TeamDataService } from '@main/services/team/TeamDataService';

export class TeamDataImportDraftRepository implements TeamImportDraftRepositoryPort {
  constructor(private readonly teamDataService: TeamDataService) {}

  async createDraft(
    teamName: string,
    preview: TeamImportPreview,
    lead: TeamImportPreview['members'][number]
  ): Promise<void> {
    await this.teamDataService.createTeamConfig({
      teamName,
      displayName: teamName,
      cwd: preview.projectPath,
      lead,
      members: preview.members.filter((member) => member.name !== lead.name),
      prompt: preview.prompt,
    });
  }
}
