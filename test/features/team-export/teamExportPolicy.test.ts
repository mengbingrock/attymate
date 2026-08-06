import {
  assembleTeamExportBundle,
  buildTeamExportFiles,
  buildTeamExportMembers,
  stripMachineSpecificWorkflow,
  TEAM_EXPORT_LIMITS,
} from '@features/team-export/core/domain/teamExportPolicy';
import { describe, expect, it } from 'vitest';

import type { TeamExportSource } from '@features/team-export/core/domain/teamExportPolicy';
import type { TeamImportBundleSkill } from '@features/team-import/contracts';

const CALENDAR_DEFINITION = `---
name: calendar-agent
description: Litigation Calendar Proposal Specialist
skills: [legal-calendaring-workflow]
---

Derive and verify litigation deadlines. Never file anything yourself.
`;

const CALENDAR_AGENT_MD = `# calendar-agent

## Role

Litigation Calendar Proposal Specialist

## Your skills

- legal-calendaring-workflow

## Memory protocol

Your durable memory lives in \`memory/MEMORY.md\` next to this file.

## Workflow

Derive and verify litigation deadlines. Never file anything yourself.
`;

const POINTER_WORKFLOW = `## Team collaboration
- When the lead assigns this board task, use task_start to mark it in progress.
- Follow the workflow below.
- Post the result to the board with task_add_comment.
- Mark the task completed with task_complete, then notify the lead with message_send.
- You are docket-agent. FIRST ACTION every session: read \`/Users/martin/.claude/teams/ca-team/agents/docket-agent/AGENT.md\` and follow it — it defines your role, skills, and workflow.
- Your durable memory is \`/Users/martin/.claude/teams/ca-team/agents/docket-agent/memory/MEMORY.md\`: read it at start, append important learnings when you finish significant work.
Confirm docket entries against the public register.`;

function source(overrides: Partial<TeamExportSource> = {}): TeamExportSource {
  return {
    teamName: 'ca-team',
    description: 'California litigation team',
    leadPrompt: 'Coordinate the matter.',
    members: [
      {
        name: 'calendar-agent',
        role: 'from members.meta',
        agentMarkdown: CALENDAR_AGENT_MD,
        agentDefinitionMarkdown: CALENDAR_DEFINITION,
      },
    ],
    ...overrides,
  };
}

const CALENDAR_SKILL: TeamImportBundleSkill = {
  slug: 'legal-calendaring-workflow',
  description: 'Litigation calendaring discipline.',
  files: [{ relativePath: 'SKILL.md', content: '---\nname: x\ndescription: y\n---\n\nBody\n' }],
};

describe('buildTeamExportMembers', () => {
  it('prefers the agent definition for role, skills, and workflow', () => {
    const { members, referencedSlugs, warnings } = buildTeamExportMembers(source());

    expect(warnings).toEqual([]);
    expect(referencedSlugs).toEqual(['legal-calendaring-workflow']);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      name: 'calendar-agent',
      role: 'Litigation Calendar Proposal Specialist',
      skills: ['legal-calendaring-workflow'],
    });
    expect(members[0].workflow).toContain('Derive and verify litigation deadlines');
  });

  it('exports no model — the bundle is model-agnostic', () => {
    // A member's model is the exporting machine's runtime configuration; a
    // bundle pinning claude-sonnet-5 forced a "codex" import onto Claude.
    const { members } = buildTeamExportMembers(source());

    expect(members[0].agentDefinition).toBeUndefined();
  });

  it('never carries agent memory into a reusable package', () => {
    const { members } = buildTeamExportMembers(source());

    expect(members[0].memoryFiles).toEqual([]);
    expect(members[0].workflow).not.toContain('Memory protocol');
  });

  it('synthesizes a member from members.meta when the team has no agents directory', () => {
    const { members, warnings } = buildTeamExportMembers(
      source({
        members: [
          { name: 'docket-agent', role: 'Court Docket Review Specialist', workflow: POINTER_WORKFLOW },
        ],
      })
    );

    expect(warnings).toEqual([]);
    expect(members[0].role).toBe('Court Docket Review Specialist');
    expect(members[0].workflow).toBe('Confirm docket entries against the public register.');
  });

  it('drops the machine-specific pointer lines from a meta workflow', () => {
    const stripped = stripMachineSpecificWorkflow(POINTER_WORKFLOW);

    expect(stripped).not.toContain('/Users/martin');
    expect(stripped).not.toContain('Team collaboration');
    expect(stripped).toBe('Confirm docket entries against the public register.');
  });

  it('skips members the importer would reject, saying why', () => {
    const { members, warnings } = buildTeamExportMembers(
      source({
        members: [
          { name: 'team-lead', role: 'lead', workflow: 'Coordinate.' },
          { name: 'calendar-agent', agentDefinitionMarkdown: CALENDAR_DEFINITION },
          { name: 'calendar-agent', agentDefinitionMarkdown: CALENDAR_DEFINITION },
          { name: 'ghost-agent' },
        ],
      })
    );

    expect(members.map((member) => member.name)).toEqual(['calendar-agent']);
    expect(warnings).toEqual([
      { code: 'memberSkipped', name: 'team-lead', reason: expect.stringContaining('memberReserved') },
      { code: 'memberSkipped', name: 'calendar-agent', reason: 'duplicate member name' },
      { code: 'memberSkipped', name: 'ghost-agent', reason: 'no workflow text found to export' },
    ]);
  });

  it('reports members dropped at the importer ceiling instead of losing them quietly', () => {
    // Letter suffixes, not numbers: the importer rejects `<base>-2` style names.
    const many = Array.from({ length: TEAM_EXPORT_LIMITS.maxMembers + 3 }, (_unused, index) => ({
      name: `agent-${String.fromCharCode(97 + index)}`,
      role: 'Specialist',
      workflow: 'Do the work.',
    }));

    const { members, warnings } = buildTeamExportMembers(source({ members: many }));

    expect(members).toHaveLength(TEAM_EXPORT_LIMITS.maxMembers);
    expect(warnings).toContainEqual({
      code: 'memberLimitExceeded',
      dropped: 3,
      limit: TEAM_EXPORT_LIMITS.maxMembers,
    });
  });
});

describe('a team owns its skills', () => {
  it('exports the project skill library even when no member names a slug', () => {
    // The reported regression: a team imported with skills exported zero of
    // them, because attribution lived only in per-member frontmatter that the
    // importer had left empty.
    const unattributed = source({
      projectSkillSlugs: ['legal-calendaring-workflow', 'lasc-docket-check'],
      members: [
        { name: 'calendar-agent', role: 'Calendar Specialist', workflow: 'Derive deadlines.' },
      ],
    });

    const { referencedSlugs, members } = buildTeamExportMembers(unattributed);

    expect(members[0].skills).toEqual([]);
    expect(referencedSlugs).toEqual(['legal-calendaring-workflow', 'lasc-docket-check']);
  });

  it('prefers the roster record over the agent markdown for member skills', () => {
    const { members, referencedSlugs } = buildTeamExportMembers(
      source({
        members: [
          {
            name: 'calendar-agent',
            skills: ['from-roster'],
            agentDefinitionMarkdown: CALENDAR_DEFINITION,
          },
        ],
      })
    );

    expect(members[0].skills).toEqual(['from-roster']);
    expect(referencedSlugs).toEqual(['from-roster']);
  });

  it('merges member references with the project library without duplicates', () => {
    const { referencedSlugs } = buildTeamExportMembers(
      source({ projectSkillSlugs: ['legal-calendaring-workflow', 'lasc-docket-check'] })
    );

    expect(referencedSlugs).toEqual(['legal-calendaring-workflow', 'lasc-docket-check']);
  });
});

describe('assembleTeamExportBundle', () => {
  it('keeps only skill references the bundle actually ships', () => {
    const membersResult = buildTeamExportMembers(source());

    const { bundle } = assembleTeamExportBundle(source(), membersResult, []);

    expect(bundle.skills).toEqual([]);
    expect(bundle.members[0].skills).toEqual([]);
  });

  it('carries the team identity and lead prompt', () => {
    const membersResult = buildTeamExportMembers(source());

    const { bundle } = assembleTeamExportBundle(source(), membersResult, [CALENDAR_SKILL]);

    expect(bundle.schema).toBe('team-import-bundle/v1');
    expect(bundle.team).toEqual({
      name: 'ca-team',
      description: 'California litigation team',
      leadPrompt: 'Coordinate the matter.',
    });
    expect(bundle.members[0].skills).toEqual(['legal-calendaring-workflow']);
  });
});

describe('buildTeamExportFiles', () => {
  it('writes the bundle, a flat agent definition, the skills, and CLAUDE.md', () => {
    const membersResult = buildTeamExportMembers(source());
    const { bundle } = assembleTeamExportBundle(source(), membersResult, [CALENDAR_SKILL]);

    const paths = buildTeamExportFiles(bundle).map((file) => file.relativePath);

    expect(paths).toEqual([
      'team-import-bundle.json',
      'agents/calendar-agent.md',
      '.claude/skills/legal-calendaring-workflow/SKILL.md',
      '.claude/CLAUDE.md',
      'README.md',
    ]);
  });

  it('emits agent files the folder scanner can read, with the role in description', () => {
    const membersResult = buildTeamExportMembers(source());
    const { bundle } = assembleTeamExportBundle(source(), membersResult, [CALENDAR_SKILL]);

    const agentFile = buildTeamExportFiles(bundle).find(
      (file) => file.relativePath === 'agents/calendar-agent.md'
    )!;

    expect(agentFile.content).toContain('name: calendar-agent');
    expect(agentFile.content).toContain('description: Litigation Calendar Proposal Specialist');
    expect(agentFile.content).toContain('skills: [legal-calendaring-workflow]');
    expect(agentFile.content).toContain('Derive and verify litigation deadlines');
  });
});
