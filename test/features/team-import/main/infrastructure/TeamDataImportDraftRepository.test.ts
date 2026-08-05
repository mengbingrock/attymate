import { TeamDataImportDraftRepository } from '@features/team-import/main/infrastructure/TeamDataImportDraftRepository';
import { describe, expect, it, vi } from 'vitest';

import type { TeamImportPreview } from '@features/team-import/contracts';
import type { TeamDataService } from '@main/services/team/TeamDataService';

describe('TeamDataImportDraftRepository', () => {
  it('promotes the selected imported profile and removes it from teammates', async () => {
    const createTeamConfig = vi.fn().mockResolvedValue(undefined);
    const repository = new TeamDataImportDraftRepository({
      createTeamConfig,
    } as unknown as TeamDataService);
    const lead = {
      name: 'legal-ops-supervisor',
      role: 'Legal operations supervisor',
      workflow: 'Coordinate the legal team.',
      skills: ['legal-ops'],
    };
    const preview: TeamImportPreview = {
      reviewId: 'review-1',
      importKind: 'deterministic',
      suggestedTeamName: 'legal-team',
      projectPath: '/tmp/legal-project',
      members: [lead, { name: 'calendar-agent', workflow: 'Track dates.' }],
      prompt: 'Handle the matter.',
      skillsFound: ['legal-ops'],
      warnings: [],
      blockingErrors: [],
    };

    await repository.createDraft('legal-team', preview, lead);

    expect(createTeamConfig).toHaveBeenCalledWith({
      teamName: 'legal-team',
      displayName: 'legal-team',
      cwd: '/tmp/legal-project',
      lead,
      members: [{ name: 'calendar-agent', workflow: 'Track dates.' }],
      prompt: 'Handle the matter.',
    });
  });
});
