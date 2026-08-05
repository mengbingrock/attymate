// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  assembleBundleJson,
  buildMemberExtractionPrompt,
  buildPlanExtractionPrompt,
  parseMemberJobOutput,
  parseSkillJobOutput,
  parseTeamImportPlan,
  selectDumpFiles,
} from '@features/team-import/core/domain/teamImportParallelParse';
import { parseTeamImportBundle } from '@features/team-import/core/domain/teamImportBundlePolicy';

const DUMP = {
  label: 'demo-package',
  truncated: false,
  files: [
    { path: 'COMPANY.md', content: '# Company constitution' },
    { path: 'agents/scout/AGENTS.md', content: 'Scout instructions' },
    { path: 'agents/scout/memory/notes.md', content: 'remember things' },
    { path: 'skills/research/SKILL.md', content: 'old skill doc' },
    { path: 'skills/research/refs/guide.md', content: 'reference guide' },
  ],
};

describe('parseTeamImportPlan', () => {
  it('parses a plan and drops unusable entries', () => {
    const plan = parseTeamImportPlan(
      JSON.stringify({
        schema: 'team-import-plan/v1',
        team: { name: 'demo', description: 'd', leadPromptPaths: ['COMPANY.md'] },
        members: [
          { name: 'scout', role: 'researcher', sourcePaths: ['agents/scout/AGENTS.md'] },
          { role: 'nameless is dropped', sourcePaths: [] },
        ],
        skills: [{ slug: 'research', description: 's', sourcePaths: ['skills/research/SKILL.md'] }],
      })
    );
    expect(plan?.members).toHaveLength(1);
    expect(plan?.skills).toHaveLength(1);
    expect(plan?.team.leadPromptPaths).toEqual(['COMPANY.md']);
  });

  it('returns null without members or valid JSON', () => {
    expect(parseTeamImportPlan('no json here')).toBeNull();
    expect(parseTeamImportPlan(JSON.stringify({ members: [] }))).toBeNull();
  });
});

describe('member and skill job outputs', () => {
  it('parses member output and falls back to plan identity', () => {
    const planMember = { name: 'scout', role: 'researcher', sourcePaths: [] };
    const parsed = parseMemberJobOutput(
      '```json\n{"workflow":"do research","skills":["research"],"memoryFilePaths":["agents/scout/memory/notes.md"]}\n```',
      planMember
    );
    expect(parsed?.name).toBe('scout');
    expect(parsed?.role).toBe('researcher');
    expect(parsed?.memoryFilePaths).toEqual(['agents/scout/memory/notes.md']);
    expect(parseMemberJobOutput('{"skills":[]}', planMember)).toBeNull();
  });

  it('parses skill output requiring at least one file', () => {
    const planSkill = { slug: 'research', description: 'd', sourcePaths: [] };
    const parsed = parseSkillJobOutput(
      JSON.stringify({
        files: [
          { relativePath: 'SKILL.md', content: '---\nname: research\n---' },
          { relativePath: 'refs/guide.md', sourcePath: 'skills/research/refs/guide.md' },
        ],
      }),
      planSkill
    );
    expect(parsed?.slug).toBe('research');
    expect(parsed?.files).toHaveLength(2);
    expect(parseSkillJobOutput('{"files":[]}', planSkill)).toBeNull();
  });
});

describe('assembleBundleJson', () => {
  it('resolves verbatim content locally and validates through the bundle policy', () => {
    const plan = parseTeamImportPlan(
      JSON.stringify({
        schema: 'team-import-plan/v1',
        team: { name: 'demo-team', description: 'a demo team', leadPromptPaths: ['COMPANY.md'] },
        members: [{ name: 'scout', role: 'researcher', sourcePaths: ['agents/scout/AGENTS.md'] }],
        skills: [{ slug: 'research', description: 'research skill', sourcePaths: [] }],
      })
    )!;
    const json = assembleBundleJson(
      plan,
      [
        {
          name: 'scout',
          role: 'researcher',
          workflow: 'Scout instructions merged',
          skills: ['research'],
          memoryFilePaths: ['agents/scout/memory/notes.md', 'missing/path.md'],
        },
      ],
      [
        {
          slug: 'research',
          description: 'research skill',
          files: [
            { relativePath: 'SKILL.md', content: '---\nname: research\ndescription: x\n---\nBody' },
            { relativePath: 'refs/guide.md', sourcePath: 'skills/research/refs/guide.md' },
          ],
        },
      ],
      DUMP
    );
    const { bundle, blockingErrors } = parseTeamImportBundle(json);
    expect(blockingErrors).toEqual([]);
    expect(bundle?.team.leadPrompt).toContain('Company constitution');
    expect(bundle?.members[0].memoryFiles).toEqual([
      { relativePath: 'memory/notes.md', content: 'remember things' },
    ]);
    expect(bundle?.skills[0].files.find((f) => f.relativePath === 'refs/guide.md')?.content).toBe(
      'reference guide'
    );
  });
});

describe('selectDumpFiles', () => {
  // The planner echoes paths it read, but not always byte for byte. Every
  // near-miss here used to resolve to nothing, leaving the member prompt
  // announcing source files it did not carry — which is what sent the model
  // looking for them with a tool and killed the job.
  it.each([
    ['exact', 'agents/scout/AGENTS.md'],
    ['a ./ prefix', './agents/scout/AGENTS.md'],
    ['a leading slash', '/agents/scout/AGENTS.md'],
    ['backslashes', 'agents\\scout\\AGENTS.md'],
    ['doubled slashes', 'agents//scout/AGENTS.md'],
    ['different case', 'Agents/Scout/agents.md'],
    ['a repository-rooted path', 'companies/demo-package/agents/scout/AGENTS.md'],
  ])('resolves %s', (_case, sourcePath: string) => {
    expect(selectDumpFiles(DUMP, [sourcePath]).map((file) => file.path)).toEqual([
      'agents/scout/AGENTS.md',
    ]);
  });

  it('never resolves a path that matches nothing', () => {
    expect(selectDumpFiles(DUMP, ['agents/ghost/AGENTS.md'])).toEqual([]);
    expect(selectDumpFiles(DUMP, [''])).toEqual([]);
  });

  it('never resolves a bare filename to some other member', () => {
    const ambiguous = {
      ...DUMP,
      files: [
        { path: 'agents/one/AGENTS.md', content: 'one' },
        { path: 'agents/two/AGENTS.md', content: 'two' },
      ],
    };
    // Attributing one member's instructions to another is worse than dropping
    // the entry, so a filename alone is never enough.
    expect(selectDumpFiles(ambiguous, ['AGENTS.md'])).toEqual([]);
    expect(selectDumpFiles(ambiguous, ['./agents/two/AGENTS.md']).map((f) => f.path)).toEqual([
      'agents/two/AGENTS.md',
    ]);
  });

  it('does not return the same file twice for duplicate references', () => {
    expect(
      selectDumpFiles(DUMP, ['agents/scout/AGENTS.md', './agents/scout/AGENTS.md'])
    ).toHaveLength(1);
  });
});

describe('prompt builders', () => {
  it('scopes member prompts to the selected files only', () => {
    const files = selectDumpFiles(DUMP, ['agents/scout/AGENTS.md']);
    const prompt = buildMemberExtractionPrompt(
      { name: 'scout', role: 'researcher', sourcePaths: ['agents/scout/AGENTS.md'] },
      files,
      ['research']
    );
    expect(prompt).toContain('Scout instructions');
    expect(prompt).not.toContain('Company constitution');
    expect(buildPlanExtractionPrompt(DUMP)).toContain('team-import-plan/v1');
  });
});
