import { SmartPreviewTeamImportUseCase } from '@features/team-import/core/application/use-cases/SmartPreviewTeamImportUseCase';
import { InMemoryTeamImportReviewStore } from '@features/team-import/main/infrastructure/InMemoryTeamImportReviewStore';
import { describe, expect, it, vi } from 'vitest';

import type { TeamImportBundleParserPort } from '@features/team-import/core/application/ports/TeamImportBundleParserPort';
import type { TeamImportFolderSourcePort } from '@features/team-import/core/application/ports/TeamImportFolderSourcePort';
import type {
  TeamImportRawSourcePort,
  TeamImportWebSourcePort,
} from '@features/team-import/core/application/ports/TeamImportRawSourcePort';
import type { TeamImportSkillsInstallerPort } from '@features/team-import/core/application/ports/TeamImportSkillsInstallerPort';
import type { TeamImportFolderSnapshot } from '@features/team-import/core/application/models/TeamImportFolderSnapshot';

const NO_PROGRESS = { report: () => undefined };

const VALID_BUNDLE_JSON = JSON.stringify({
  schema: 'team-import-bundle/v1',
  team: { name: 'imported', leadPrompt: 'Coordinate.' },
  members: [
    { name: 'writer', role: 'member', workflow: 'Write.', skills: [], memoryFiles: [] },
  ],
  skills: [],
});

function claudeStyleSnapshot(): TeamImportFolderSnapshot {
  return {
    projectPath: '/picked',
    folderName: 'picked',
    agentFiles: [{ fileName: 'writer.md', content: '---\nname: writer\n---\nWrite well.' }],
    claudeMd: undefined,
    skills: [],
    warnings: [],
  };
}

function emptySnapshot(): TeamImportFolderSnapshot {
  return { ...claudeStyleSnapshot(), agentFiles: [] };
}

interface Fakes {
  deterministicSnapshot: TeamImportFolderSnapshot;
  parserOutput: string;
  pickedFolder: string | null;
}

function buildUseCase(overrides: Partial<Fakes> = {}) {
  const fakes: Fakes = {
    deterministicSnapshot: claudeStyleSnapshot(),
    parserOutput: VALID_BUNDLE_JSON,
    pickedFolder: '/picked',
    ...overrides,
  };
  const reviewStore = new InMemoryTeamImportReviewStore();
  const deterministicSource: TeamImportFolderSourcePort = {
    inspect: vi.fn().mockResolvedValue(fakes.deterministicSnapshot),
  };
  const rawSource: TeamImportRawSourcePort = {
    readFolder: vi.fn().mockResolvedValue({
      label: 'folder picked',
      files: [{ path: 'COMPANY.md', content: 'We are a company.' }],
      truncated: false,
    }),
  };
  const webSource: TeamImportWebSourcePort = {
    fetchPage: vi.fn().mockResolvedValue({
      label: 'webpage example.com',
      files: [{ path: 'https://example.com', content: 'A team of agents.' }],
      truncated: true,
    }),
  };
  const parser: TeamImportBundleParserPort = {
    parse: vi.fn().mockResolvedValue(fakes.parserOutput),
  };
  const skillsInstaller: TeamImportSkillsInstallerPort = {
    listExistingSlugs: async () => new Set(),
    install: vi.fn(),
  };
  const useCase = new SmartPreviewTeamImportUseCase(
    { chooseFolder: vi.fn().mockResolvedValue(fakes.pickedFolder) },
    deterministicSource,
    rawSource,
    webSource,
    parser,
    skillsInstaller,
    reviewStore
  );
  return { useCase, reviewStore, deterministicSource, rawSource, webSource, parser };
}

describe('SmartPreviewTeamImportUseCase', () => {
  it('returns null when the folder picker is cancelled', async () => {
    const { useCase, parser } = buildUseCase({ pickedFolder: null });
    await expect(useCase.execute({ kind: 'folder', smart: false }, NO_PROGRESS)).resolves.toBeNull();
    expect(parser.parse).not.toHaveBeenCalled();
  });

  it('uses the deterministic parser for non-smart folder imports', async () => {
    const { useCase, parser } = buildUseCase();
    const preview = await useCase.execute({ kind: 'folder', smart: false }, NO_PROGRESS);
    expect(preview?.importKind).toBe('deterministic');
    expect(preview?.members[0]?.name).toBe('writer');
    expect(parser.parse).not.toHaveBeenCalled();
  });

  it('returns the empty deterministic preview without invoking the LLM when smart is off', async () => {
    const { useCase, parser } = buildUseCase({ deterministicSnapshot: emptySnapshot() });
    const preview = await useCase.execute({ kind: 'folder', smart: false }, NO_PROGRESS);
    expect(preview?.importKind).toBe('deterministic');
    expect(preview?.blockingErrors.length).toBeGreaterThan(0);
    expect(parser.parse).not.toHaveBeenCalled();
  });

  it('parses via the LLM when smart is on and keeps the bundle in the review store', async () => {
    const { useCase, reviewStore, parser } = buildUseCase();
    const preview = await useCase.execute({ kind: 'folder', smart: true }, NO_PROGRESS);
    // Plan attempt (output is not a plan) + single-shot fallback.
    expect(parser.parse).toHaveBeenCalledTimes(2);
    expect(preview?.importKind).toBe('smart');
    expect(preview?.suggestedTeamName).toBe('imported');
    const record = reviewStore.consume(preview!.reviewId);
    expect(record?.bundle?.members[0]?.name).toBe('writer');
  });

  it('reuses a provided folder path without opening the picker', async () => {
    const { useCase, parser } = buildUseCase({ pickedFolder: null });
    const preview = await useCase.execute(
      { kind: 'folder', smart: true, folderPath: '/previous' },
      NO_PROGRESS
    );
    expect(preview?.importKind).toBe('smart');
    expect(parser.parse).toHaveBeenCalledTimes(2);
  });

  it('fans out parallel sub-agent jobs when the plan phase succeeds', async () => {
    const { useCase, reviewStore, parser } = buildUseCase();
    vi.mocked(parser.parse).mockImplementation(async (prompt: string) => {
      if (prompt.includes('team-import-plan/v1')) {
        return JSON.stringify({
          schema: 'team-import-plan/v1',
          team: { name: 'planned', description: 'planned team', leadPromptPaths: ['COMPANY.md'] },
          members: [
            { name: 'writer', role: 'writes', sourcePaths: ['COMPANY.md'] },
            { name: 'editor', role: 'edits', sourcePaths: ['COMPANY.md'] },
          ],
          skills: [{ slug: 'style', description: 'style guide', sourcePaths: ['COMPANY.md'] }],
        });
      }
      if (prompt.includes('ONE team member')) {
        const name = /"name": "(\w+)"/.exec(prompt)?.[1] ?? 'writer';
        return JSON.stringify({
          name,
          role: 'r',
          workflow: `${name} workflow`,
          skills: ['style'],
          memoryFilePaths: [],
        });
      }
      return JSON.stringify({
        slug: 'style',
        description: 'style guide',
        files: [{ relativePath: 'SKILL.md', content: '---\nname: style\ndescription: x\n---\nS' }],
      });
    });

    const preview = await useCase.execute({ kind: 'folder', smart: true }, NO_PROGRESS);
    // 1 plan + 2 members + 1 skill.
    expect(parser.parse).toHaveBeenCalledTimes(4);
    expect(preview?.suggestedTeamName).toBe('planned');
    const record = reviewStore.consume(preview!.reviewId);
    expect(record?.bundle?.members.map((member) => member.name).sort()).toEqual([
      'editor',
      'writer',
    ]);
    expect(record?.bundle?.team.leadPrompt).toContain('We are a company.');
    expect(record?.bundle?.skills[0]?.slug).toBe('style');
  });

  it('imports from a URL and flags truncated sources', async () => {
    const { useCase } = buildUseCase();
    const preview = await useCase.execute(
      { kind: 'url', url: 'https://example.com/team' },
      NO_PROGRESS
    );
    expect(preview?.importKind).toBe('smart');
    expect(preview?.projectPath).toBe('');
    expect(preview?.warnings).toContainEqual({ code: 'bundleSourceTruncated' });
  });

  it('rejects non-http URLs', async () => {
    const { useCase } = buildUseCase();
    await expect(
      useCase.execute({ kind: 'url', url: 'file:///etc/passwd' }, NO_PROGRESS)
    ).rejects.toThrow('TEAM_IMPORT_VALIDATION:invalidUrl');
  });

  it('stores a blocked preview when the LLM returns garbage', async () => {
    const { useCase } = buildUseCase({ parserOutput: 'not json at all' });
    const preview = await useCase.execute({ kind: 'folder', smart: true }, NO_PROGRESS);
    expect(preview?.blockingErrors.length).toBeGreaterThan(0);
    expect(preview?.members).toEqual([]);
  });

  it('reports elapsed parsing progress with streamed character counts', async () => {
    const reports: Array<{ stage: string; elapsedSeconds?: number; receivedChars?: number }> = [];
    const { useCase, parser } = buildUseCase();
    vi.mocked(parser.parse).mockImplementation(async (_prompt, onProgress) => {
      onProgress?.(1234);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      return VALID_BUNDLE_JSON;
    });

    await useCase.execute({ kind: 'folder', smart: true }, { report: (p) => reports.push(p) });

    const parsingReports = reports.filter((report) => report.stage === 'parsing');
    expect(parsingReports[0]).toEqual({ stage: 'parsing', elapsedSeconds: 0 });
    expect(parsingReports.length).toBeGreaterThan(1);
    const last = parsingReports[parsingReports.length - 1];
    // Aggregate across jobs: the plan attempt and the single-shot fallback
    // each streamed 1234 characters.
    expect(last.receivedChars).toBe(2468);
    expect(last.elapsedSeconds).toBeGreaterThanOrEqual(1);
    expect(reports[reports.length - 1]).toEqual({ stage: 'validating' });
  });
});
