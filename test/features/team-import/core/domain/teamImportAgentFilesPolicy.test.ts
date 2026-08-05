import {
  AGENT_INSTRUCTIONS_FILE,
  AGENT_MEMORY_FILE,
  buildAgentFiles,
  buildClaudeAgentDefinitionMarkdown,
  buildWorkflowPointer,
  bundleToPreview,
} from '@features/team-import/core/domain/teamImportAgentFilesPolicy';
import { describe, expect, it } from 'vitest';

import type { TeamImportBundle, TeamImportBundleMember } from '@features/team-import/contracts';

function member(overrides: Partial<TeamImportBundleMember> = {}): TeamImportBundleMember {
  return {
    name: 'researcher',
    role: 'Finds authority',
    workflow: 'Research carefully.',
    skills: ['legal-research'],
    memoryFiles: [],
    ...overrides,
  };
}

function bundle(): TeamImportBundle {
  return {
    schema: 'team-import-bundle/v1',
    team: {
      name: 'legal-team',
      description: 'A team.',
      leadPrompt: 'Coordinate.',
      suggestedLeadName: 'researcher',
    },
    members: [member()],
    skills: [
      {
        slug: 'legal-research',
        description: 'Research skill.',
        files: [{ relativePath: 'SKILL.md', content: 'skill' }],
      },
    ],
  };
}

describe('buildAgentFiles', () => {
  it('produces AGENT.md with role, skills, memory protocol, and workflow', () => {
    const files = buildAgentFiles(member(), new Map([['legal-research', 'Research skill.']]));
    const agentMd = files.find((file) => file.relativePath === AGENT_INSTRUCTIONS_FILE);
    expect(agentMd?.content).toContain('Finds authority');
    expect(agentMd?.content).toContain('legal-research — Research skill.');
    expect(agentMd?.content).toContain(AGENT_MEMORY_FILE);
    expect(agentMd?.content).toContain('Research carefully.');
  });

  it.each([
    ['member skills only', member({ skills: ['legal-research'] })],
    [
      'agentDefinition skills only',
      member({ skills: [], agentDefinition: { skills: ['legal-research'] } }),
    ],
    [
      'both, definition wins',
      member({ skills: ['stale'], agentDefinition: { skills: ['legal-research'] } }),
    ],
  ])(
    'keeps AGENT.md and the Claude definition in agreement (%s)',
    (_case, input: TeamImportBundleMember) => {
      const files = buildAgentFiles(input, new Map([['legal-research', 'Research skill.']]));
      const agentMd = files.find((file) => file.relativePath === AGENT_INSTRUCTIONS_FILE)!.content;
      const definition = buildClaudeAgentDefinitionMarkdown(input);

      // An agent told "(none assigned)" while its own definition lists skills
      // is the bug this guards: the runtime only ever reads AGENT.md.
      expect(agentMd).toContain('legal-research');
      expect(agentMd).not.toContain('(none assigned');
      expect(definition).toContain('skills: [legal-research]');
    }
  );

  it('seeds MEMORY.md when the member has none', () => {
    const files = buildAgentFiles(member(), new Map());
    expect(files.some((file) => file.relativePath === AGENT_MEMORY_FILE)).toBe(true);
  });

  it('keeps an imported MEMORY.md and prefixes loose memory files', () => {
    const files = buildAgentFiles(
      member({
        memoryFiles: [
          { relativePath: AGENT_MEMORY_FILE, content: 'existing memory' },
          { relativePath: 'notes.md', content: 'loose' },
        ],
      }),
      new Map()
    );
    const memoryFiles = files.filter((file) => file.relativePath === AGENT_MEMORY_FILE);
    expect(memoryFiles).toHaveLength(1);
    expect(memoryFiles[0].content).toBe('existing memory');
    expect(files.some((file) => file.relativePath === 'memory/notes.md')).toBe(true);
  });
});

describe('buildWorkflowPointer', () => {
  it('points at the agent instruction and memory files', () => {
    const pointer = buildWorkflowPointer('/home/user/.claude/teams/demo/agents/researcher', 'researcher');
    expect(pointer).toContain('/home/user/.claude/teams/demo/agents/researcher/AGENT.md');
    expect(pointer).toContain('/home/user/.claude/teams/demo/agents/researcher/memory/MEMORY.md');
    expect(pointer).toContain('Team collaboration');
  });
});

describe('bundleToPreview', () => {
  it('puts skills on the roster members so the assignment is persisted', () => {
    const preview = bundleToPreview(bundle(), {
      projectPath: '/project',
      sourceLabel: 'folder',
      existingSkillSlugs: new Set(),
    });

    expect(preview.members[0].skills).toEqual(['legal-research']);
  });

  it('maps the bundle to a smart preview with skill plans and member details', () => {
    const preview = bundleToPreview(bundle(), {
      projectPath: '/source',
      sourceLabel: 'folder demo',
      existingSkillSlugs: new Set(['legal-research']),
    });
    expect(preview.importKind).toBe('smart');
    expect(preview.suggestedTeamName).toBe('legal-team');
    expect(preview.suggestedLeadName).toBe('researcher');
    expect(preview.members[0].workflow).toBe('Research carefully.');
    expect(preview.memberDetails?.[0]).toEqual({
      name: 'researcher',
      role: 'Finds authority',
      skills: ['legal-research'],
      memoryFileCount: 0,
    });
    expect(preview.skillPlans?.[0]).toMatchObject({ slug: 'legal-research', alreadyExists: true });
    expect(preview.prompt).toContain('Coordinate.');
  });
});

describe('buildClaudeAgentDefinitionMarkdown', () => {
  it('renders standard subagent frontmatter from the captured definition', () => {
    const markdown = buildClaudeAgentDefinitionMarkdown({
      name: 'legal-researcher',
      role: 'Finds controlling authority',
      workflow: 'Research and cite-check.',
      skills: ['lexis-legal-research'],
      memoryFiles: [],
      agentDefinition: {
        tools: ['Read', 'Grep', 'WebSearch'],
        disallowedTools: ['Bash'],
        model: 'sonnet',
        permissionMode: 'plan',
        maxTurns: 30,
        mcpServers: ['lexis'],
        hooks: { TeammateIdle: 'run QA checklist' },
        memory: 'project',
      },
    });
    expect(markdown).toContain('name: legal-researcher');
    expect(markdown).toContain('description: Finds controlling authority');
    expect(markdown).toContain('tools: Read, Grep, WebSearch');
    expect(markdown).toContain('disallowedTools: Bash');
    expect(markdown).toContain('model: sonnet');
    expect(markdown).toContain('permissionMode: plan');
    expect(markdown).toContain('maxTurns: 30');
    expect(markdown).toContain('skills: [lexis-legal-research]');
    expect(markdown).toContain('mcpServers: [lexis]');
    expect(markdown).toContain('memory: project');
    expect(markdown).toContain('Research and cite-check.');
    expect(markdown).toContain('Hooks described by the source');
  });

  it('falls back to member skills and minimal frontmatter without a definition', () => {
    const markdown = buildClaudeAgentDefinitionMarkdown({
      name: 'scout',
      role: '',
      workflow: 'Look around.',
      skills: ['recon'],
      memoryFiles: [],
    });
    expect(markdown).toContain('name: scout');
    expect(markdown).toContain('description: Imported team member.');
    expect(markdown).toContain('skills: [recon]');
    expect(markdown).not.toContain('tools:');
    expect(markdown).not.toContain('permissionMode:');
  });
});
