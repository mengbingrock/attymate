import {
  extractJsonObjectText,
  parseTeamImportBundle,
  sanitizeBundleRelativePath,
  TEAM_IMPORT_BUNDLE_LIMITS,
} from '@features/team-import/core/domain/teamImportBundlePolicy';
import { describe, expect, it } from 'vitest';

function validBundleJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 'team-import-bundle/v1',
    team: { name: 'Legal Team', description: 'A team.', leadPrompt: 'Coordinate.' },
    members: [
      {
        name: 'researcher',
        role: 'Finds authority',
        workflow: 'Research things.',
        skills: ['legal-research', 'unknown-skill'],
        memoryFiles: [{ relativePath: 'memory/notes.md', content: 'notes' }],
      },
    ],
    skills: [
      {
        slug: 'Legal Research',
        description: 'Research skill.',
        files: [{ relativePath: 'SKILL.md', content: '---\nname: legal-research\n---\nbody' }],
      },
    ],
    ...overrides,
  });
}

describe('extractJsonObjectText', () => {
  it('accepts raw JSON', () => {
    expect(extractJsonObjectText('{"a":1}')).toBe('{"a":1}');
  });

  it('accepts fenced JSON', () => {
    expect(extractJsonObjectText('Sure!\n```json\n{"a":1}\n```\nDone.')).toBe('{"a":1}');
  });

  it('accepts prose-wrapped JSON via brace slicing', () => {
    expect(extractJsonObjectText('Here it is: {"a":{"b":2}} hope it helps')).toBe('{"a":{"b":2}}');
  });

  it('returns null when no object exists', () => {
    expect(extractJsonObjectText('no json here')).toBeNull();
  });
});

describe('sanitizeBundleRelativePath', () => {
  it('normalizes plain relative paths', () => {
    expect(sanitizeBundleRelativePath('memory/notes.md')).toBe('memory/notes.md');
    expect(sanitizeBundleRelativePath('./SKILL.md')).toBe('SKILL.md');
  });

  it('rejects traversal and absolute paths', () => {
    expect(sanitizeBundleRelativePath('../evil.md')).toBeNull();
    expect(sanitizeBundleRelativePath('a/../../evil.md')).toBeNull();
    expect(sanitizeBundleRelativePath('/etc/passwd')).toBeNull();
    expect(sanitizeBundleRelativePath('C:/windows/system32')).toBeNull();
    expect(sanitizeBundleRelativePath('a/.hidden/../x')).toBeNull();
  });
});

describe('parseTeamImportBundle', () => {
  it('parses a valid bundle, normalizes slugs, and filters unknown member skills', () => {
    const { bundle, blockingErrors } = parseTeamImportBundle(validBundleJson());
    expect(blockingErrors).toEqual([]);
    expect(bundle).not.toBeNull();
    expect(bundle?.team.name).toBe('legal-team');
    expect(bundle?.members[0].skills).toEqual(['legal-research']);
    expect(bundle?.skills[0].slug).toBe('legal-research');
  });

  it('blocks on garbage output', () => {
    const { bundle, blockingErrors } = parseTeamImportBundle('total nonsense');
    expect(bundle).toBeNull();
    expect(blockingErrors.length).toBeGreaterThan(0);
  });

  it('blocks when no members survive validation', () => {
    const raw = validBundleJson({
      members: [{ name: 'team-lead', role: 'x', workflow: 'y', skills: [], memoryFiles: [] }],
    });
    const { bundle, blockingErrors, warnings } = parseTeamImportBundle(raw);
    expect(bundle).toBeNull();
    expect(blockingErrors.length).toBeGreaterThan(0);
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'bundleMemberDropped', name: 'team-lead' })
    );
  });

  it('drops members beyond the limit with a warning', () => {
    const members = Array.from({ length: TEAM_IMPORT_BUNDLE_LIMITS.maxMembers + 2 }, (_, index) => ({
      name: `member-a${index}`,
      role: 'x',
      workflow: 'y',
      skills: [],
      memoryFiles: [],
    }));
    const { bundle, warnings } = parseTeamImportBundle(validBundleJson({ members }));
    expect(bundle?.members).toHaveLength(TEAM_IMPORT_BUNDLE_LIMITS.maxMembers);
    expect(warnings.some((warning) => warning.code === 'bundleMemberDropped')).toBe(true);
  });

  it('drops unsafe memory file paths with a warning', () => {
    const raw = validBundleJson({
      members: [
        {
          name: 'researcher',
          role: 'x',
          workflow: 'y',
          skills: [],
          memoryFiles: [
            { relativePath: '../../escape.md', content: 'bad' },
            { relativePath: 'memory/ok.md', content: 'good' },
          ],
        },
      ],
    });
    const { bundle, warnings } = parseTeamImportBundle(raw);
    expect(bundle?.members[0].memoryFiles).toEqual([
      { relativePath: 'memory/ok.md', content: 'good' },
    ]);
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'bundleFileDropped' }));
  });

  it('synthesizes SKILL.md when a skill lacks one', () => {
    const raw = validBundleJson({
      skills: [
        {
          slug: 'drafting',
          description: 'Draft documents.',
          files: [{ relativePath: 'references/how.md', content: 'ref' }],
        },
      ],
    });
    const { bundle } = parseTeamImportBundle(raw);
    const skill = bundle?.skills[0];
    expect(skill?.files[0].relativePath).toBe('SKILL.md');
    expect(skill?.files[0].content).toContain('name: drafting');
  });

  it('drops duplicate members and skills', () => {
    const raw = validBundleJson({
      members: [
        { name: 'writer', role: 'x', workflow: 'y', skills: [], memoryFiles: [] },
        { name: 'Writer', role: 'x', workflow: 'y', skills: [], memoryFiles: [] },
      ],
      skills: [
        { slug: 'drafting', description: 'a', files: [] },
        { slug: 'drafting', description: 'b', files: [] },
      ],
    });
    const { bundle, warnings } = parseTeamImportBundle(raw);
    expect(bundle?.members).toHaveLength(1);
    expect(bundle?.skills).toHaveLength(1);
    expect(warnings.filter((warning) => warning.code === 'bundleMemberDropped')).toHaveLength(1);
    expect(warnings.filter((warning) => warning.code === 'bundleSkillDropped')).toHaveLength(1);
  });
});

describe('agentDefinition normalization', () => {
  it('keeps grounded Claude Code frontmatter fields and drops invalid values', () => {
    const raw = validBundleJson({
      members: [
        {
          name: 'researcher',
          role: 'r',
          workflow: 'w',
          skills: [],
          memoryFiles: [],
          agentDefinition: {
            tools: ['Read', 'Grep', 'Read', ''],
            disallowedTools: ['Bash'],
            model: '  sonnet  ',
            permissionMode: 'plan',
            maxTurns: 25,
            mcpServers: ['lexis'],
            hooks: { TeammateIdle: 'require QA checklist before idle' },
            memory: 'project',
          },
        },
        {
          name: 'writer',
          role: 'r',
          workflow: 'w',
          skills: [],
          memoryFiles: [],
          agentDefinition: {
            permissionMode: 'sudo-everything',
            maxTurns: -3,
            model: '',
            hooks: [],
          },
        },
      ],
    });
    const { bundle, blockingErrors } = parseTeamImportBundle(raw);
    expect(blockingErrors).toEqual([]);
    const researcher = bundle?.members.find((member) => member.name === 'researcher');
    expect(researcher?.agentDefinition).toEqual({
      tools: ['Read', 'Grep'],
      disallowedTools: ['Bash'],
      model: 'sonnet',
      permissionMode: 'plan',
      maxTurns: 25,
      mcpServers: ['lexis'],
      hooks: { TeammateIdle: 'require QA checklist before idle' },
      memory: 'project',
    });
    // Every field invalid -> the object is dropped entirely.
    const writer = bundle?.members.find((member) => member.name === 'writer');
    expect(writer?.agentDefinition).toBeUndefined();
  });
});
