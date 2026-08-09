import { CreateTeamImportDraftUseCase } from '@features/team-import/core/application/use-cases/CreateTeamImportDraftUseCase';
import { InMemoryTeamImportReviewStore } from '@features/team-import/main/infrastructure/InMemoryTeamImportReviewStore';
import { describe, expect, it, vi } from 'vitest';

import type { TeamImportBundle, TeamImportPreview } from '@features/team-import/contracts';
import type { TeamImportAgentFilesWriterPort } from '@features/team-import/core/application/ports/TeamImportAgentFilesWriterPort';
import type { TeamImportDraftRepositoryPort } from '@features/team-import/core/application/ports/TeamImportDraftRepositoryPort';
import type { TeamImportSkillsInstallerPort } from '@features/team-import/core/application/ports/TeamImportSkillsInstallerPort';

function previewInput(): Omit<TeamImportPreview, 'reviewId'> {
  return {
    importKind: 'deterministic',
    suggestedTeamName: 'demo-team',
    projectPath: '/project',
    members: [{ name: 'writer', role: 'member', workflow: 'Write.' }],
    prompt: 'Coordinate the work.',
    skillsFound: [],
    warnings: [],
    blockingErrors: [],
  };
}

function smartBundle(): TeamImportBundle {
  return {
    schema: 'team-import-bundle/v1',
    team: { name: 'demo-team', leadPrompt: 'Coordinate.' },
    members: [
      {
        name: 'writer',
        role: 'member',
        workflow: 'Full imported workflow.',
        skills: ['drafting'],
        memoryFiles: [{ relativePath: 'memory/notes.md', content: 'notes' }],
      },
    ],
    skills: [
      {
        slug: 'drafting',
        description: 'Draft things.',
        files: [{ relativePath: 'SKILL.md', content: 'skill' }],
      },
    ],
  };
}

function fakeAgentFilesWriter(): TeamImportAgentFilesWriterPort {
  return {
    resolveAgentDir: (teamName, memberName) => `/teams/${teamName}/agents/${memberName}`,
    writeAgentFiles: vi.fn().mockResolvedValue(undefined),
  };
}

function fakeSkillsInstaller(
  install: TeamImportSkillsInstallerPort['install'] = vi
    .fn()
    .mockResolvedValue({ status: 'installed' })
): TeamImportSkillsInstallerPort {
  return { listExistingSlugs: () => Promise.resolve(new Set<string>()), install };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function buildUseCase(
  reviewStore: InMemoryTeamImportReviewStore,
  draftRepository: TeamImportDraftRepositoryPort,
  agentFilesWriter = fakeAgentFilesWriter(),
  skillsInstaller = fakeSkillsInstaller()
) {
  return new CreateTeamImportDraftUseCase(
    reviewStore,
    draftRepository,
    agentFilesWriter,
    skillsInstaller
  );
}

describe('CreateTeamImportDraftUseCase', () => {
  it('atomically consumes a review before awaiting draft persistence', async () => {
    const reviewStore = new InMemoryTeamImportReviewStore();
    const preview = reviewStore.save(previewInput());
    const pendingCreate = deferred<void>();
    const draftRepository: TeamImportDraftRepositoryPort = {
      createDraft: vi.fn(() => pendingCreate.promise),
    };
    const useCase = buildUseCase(reviewStore, draftRepository);

    const first = useCase.execute({
      reviewId: preview.reviewId,
      teamName: 'first-team',
      leadName: 'writer',
    });
    await expect(
      useCase.execute({
        reviewId: preview.reviewId,
        teamName: 'second-team',
        leadName: 'writer',
      })
    ).rejects.toThrow('expired');
    expect(draftRepository.createDraft).toHaveBeenCalledTimes(1);

    pendingCreate.resolve();
    await expect(first).resolves.toEqual({ teamName: 'first-team' });
  });

  it('restores a consumed review when persistence fails', async () => {
    const reviewStore = new InMemoryTeamImportReviewStore();
    const preview = reviewStore.save(previewInput());
    const draftRepository: TeamImportDraftRepositoryPort = {
      createDraft: vi
        .fn()
        .mockRejectedValueOnce(new Error('disk full'))
        .mockResolvedValueOnce(undefined),
    };
    const useCase = buildUseCase(reviewStore, draftRepository);
    const request = { reviewId: preview.reviewId, teamName: 'demo-team', leadName: 'writer' };

    await expect(useCase.execute(request)).rejects.toThrow('disk full');
    await expect(useCase.execute(request)).resolves.toEqual({ teamName: 'demo-team' });
    expect(draftRepository.createDraft).toHaveBeenCalledTimes(2);
  });

  it('persists pointer workflows, then writes agent files and installs skills for smart bundles', async () => {
    const reviewStore = new InMemoryTeamImportReviewStore();
    const bundle = smartBundle();
    const preview = reviewStore.save(
      {
        ...previewInput(),
        importKind: 'smart',
        members: [{ name: 'writer', role: 'member', workflow: bundle.members[0].workflow }],
      },
      bundle
    );
    const createDraft = vi.fn().mockResolvedValue(undefined);
    const agentFilesWriter = fakeAgentFilesWriter();
    const skillsInstaller = fakeSkillsInstaller();
    const useCase = buildUseCase(reviewStore, { createDraft }, agentFilesWriter, skillsInstaller);

    const result = await useCase.execute({
      reviewId: preview.reviewId,
      teamName: 'demo-team',
      leadName: 'writer',
    });

    expect(result).toEqual({ teamName: 'demo-team' });
    const persistedPreview = createDraft.mock.calls[0][1] as TeamImportPreview;
    const persistedLead = createDraft.mock.calls[0][2] as TeamImportPreview['members'][number];
    expect(persistedPreview.members[0].workflow).toContain(
      '/teams/demo-team/agents/writer/AGENT.md'
    );
    expect(persistedPreview.members[0].workflow).not.toContain('Full imported workflow.');
    expect(persistedLead).toEqual(persistedPreview.members[0]);
    expect(agentFilesWriter.writeAgentFiles).toHaveBeenCalledWith(
      'demo-team',
      'writer',
      expect.arrayContaining([expect.objectContaining({ relativePath: 'AGENT.md' })])
    );
    expect(skillsInstaller.install).toHaveBeenCalledTimes(1);
    // Skills belong to the team, so they install into the team's own store.
    expect(vi.mocked(skillsInstaller.install).mock.calls[0][1]).toEqual({
      teamName: 'demo-team',
      projectPath: '/project',
    });
  });

  it('still gives the team its own skill copy when the source has no project folder', async () => {
    const reviewStore = new InMemoryTeamImportReviewStore();
    const preview = reviewStore.save(
      { ...previewInput(), importKind: 'smart', projectPath: '' },
      smartBundle()
    );
    const skillsInstaller = fakeSkillsInstaller();
    const useCase = buildUseCase(
      reviewStore,
      { createDraft: vi.fn().mockResolvedValue(undefined) },
      fakeAgentFilesWriter(),
      skillsInstaller
    );

    const result = await useCase.execute({
      reviewId: preview.reviewId,
      teamName: 'demo-team',
      leadName: 'writer',
    });

    // A URL import has no folder to scope to, and no longer needs one: the
    // team store is the target either way, so there is nothing to warn about.
    expect(vi.mocked(skillsInstaller.install).mock.calls[0][1]).toEqual({ teamName: 'demo-team' });
    expect(result.applyWarnings).toBeUndefined();
  });

  it('collects apply warnings instead of failing when skills or agent files fail', async () => {
    const reviewStore = new InMemoryTeamImportReviewStore();
    const preview = reviewStore.save({ ...previewInput(), importKind: 'smart' }, smartBundle());
    const agentFilesWriter: TeamImportAgentFilesWriterPort = {
      resolveAgentDir: () => '/teams/demo-team/agents/writer',
      writeAgentFiles: vi.fn().mockRejectedValue(new Error('read-only fs')),
    };
    const skillsInstaller = fakeSkillsInstaller(
      vi.fn().mockResolvedValue({ status: 'skipped', detail: 'already exists' })
    );
    const useCase = buildUseCase(
      reviewStore,
      { createDraft: vi.fn().mockResolvedValue(undefined) },
      agentFilesWriter,
      skillsInstaller
    );

    const result = await useCase.execute({
      reviewId: preview.reviewId,
      teamName: 'demo-team',
      leadName: 'writer',
    });
    expect(result.teamName).toBe('demo-team');
    expect(result.applyWarnings).toHaveLength(2);
    expect(result.applyWarnings?.[0]).toContain('read-only fs');
    expect(result.applyWarnings?.[1]).toContain('already exists');
  });

  it('rejects a lead that is not one of the imported profiles', async () => {
    const reviewStore = new InMemoryTeamImportReviewStore();
    const preview = reviewStore.save(previewInput());
    const createDraft = vi.fn().mockResolvedValue(undefined);
    const useCase = buildUseCase(reviewStore, { createDraft });

    await expect(
      useCase.execute({
        reviewId: preview.reviewId,
        teamName: 'demo-team',
        leadName: 'not-imported',
      })
    ).rejects.toThrow('leadNotFound');
    expect(createDraft).not.toHaveBeenCalled();
  });
});
