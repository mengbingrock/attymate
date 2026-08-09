import {
  MATTER_SKILL_MARKDOWN,
  MATTER_SKILL_SLUG,
  stripSkillFrontmatter,
} from '@features/matter-dashboard/core/domain/matterSkillDefinition';
import { buildMatterSkillInvocationPrompt } from '@features/matter-dashboard/main';
import { SkillMetadataParser } from '@main/services/extensions/skills/SkillMetadataParser';
import { describe, expect, it } from 'vitest';

import type { ResolvedSkillRoot } from '@main/services/extensions/skills/SkillRootsResolver';

const ROOT: ResolvedSkillRoot = {
  scope: 'user',
  rootKind: 'claude',
  teamName: null,
  projectRoot: null,
  rootPath: '/home/user/.claude/skills',
};

function parseSkill(folderName: string) {
  return new SkillMetadataParser().parseCatalogItem({
    skillDir: `${ROOT.rootPath}/${folderName}`,
    folderName,
    skillFile: `${ROOT.rootPath}/${folderName}/SKILL.md`,
    rawContent: MATTER_SKILL_MARKDOWN,
    modifiedAt: 0,
    flags: { hasScripts: false, hasReferences: false, hasAssets: false },
    root: ROOT,
  });
}

describe('matter dashboard skill definition', () => {
  it('parses as a valid ordinary skill', () => {
    const item = parseSkill(MATTER_SKILL_SLUG);
    const errors = item.issues.filter((issue) => issue.severity === 'error');

    expect(errors).toEqual([]);
    expect(item.isValid).toBe(true);
    // The parser errors when the frontmatter name and the folder disagree, so
    // the slug the seeder writes must match the name in the markdown.
    expect(item.name).toBe(MATTER_SKILL_SLUG);
    expect(item.description.length).toBeGreaterThan(20);
  });

  it('carries no app-managed frontmatter, since the user owns it once seeded', () => {
    const item = parseSkill(MATTER_SKILL_SLUG);

    expect(item.issues.some((issue) => issue.code === 'unknown-frontmatter-keys')).toBe(false);
    expect(item.metadata).toEqual({});
  });

  it('keeps the propose-only contract and the section schema in the body', () => {
    const body = stripSkillFrontmatter(MATTER_SKILL_MARKDOWN);

    expect(body).toContain('matter_get');
    expect(body).toContain('matter_propose');
    expect(body).toContain('Never invent dates');
    expect(body).toContain('nextDeadline');
    expect(body).not.toContain('---\nname:');
  });
});

describe('buildMatterSkillInvocationPrompt', () => {
  const TEAM_SKILL_FILE = '/app-data/skills/teams/signal-ops/matter-dashboard/SKILL.md';
  const INLINE_FENCE = `--- ${MATTER_SKILL_SLUG} skill ---`;
  const base = {
    teamName: 'signal-ops',
    projectPath: '/cases/1234567',
    hasTeammates: true,
    canSpawnTeammates: true,
    skillFilePath: TEAM_SKILL_FILE,
    skillMarkdown: MATTER_SKILL_MARKDOWN,
    trigger: 'user-refresh' as const,
  };

  it('frames an empty dashboard as the initial scan', () => {
    const prompt = buildMatterSkillInvocationPrompt({ ...base, mode: 'initial-scan' });

    expect(prompt).toContain('The user asked you to refresh');
    expect(prompt).toContain('INITIAL SCAN');
    expect(prompt).toContain('/cases/1234567');
    expect(prompt).not.toContain('UPDATE SCAN');
  });

  it('frames a populated dashboard as an update, naming the finished task', () => {
    const prompt = buildMatterSkillInvocationPrompt({
      ...base,
      mode: 'update',
      trigger: 'job-wrap-up',
      completedTaskLabel: 'Task 12 "Serve RFPs"',
    });

    expect(prompt).toContain('All tasks are complete (last: Task 12 "Serve RFPs")');
    expect(prompt).toContain('UPDATE SCAN');
  });

  it('permits extra specialists only on runtimes that can spawn them', () => {
    const spawning = buildMatterSkillInvocationPrompt({ ...base, mode: 'update' });
    expect(spawning).toContain('spawn additional instances');
    expect(spawning).not.toContain('do NOT create, replace, or duplicate teammates');

    const lanes = buildMatterSkillInvocationPrompt({
      ...base,
      mode: 'update',
      canSpawnTeammates: false,
    });
    expect(lanes).toContain('private subagents');
    expect(lanes).toContain('do NOT create, replace, or duplicate teammates');
    expect(lanes).not.toContain('spawn additional instances');
  });

  it('references the team copy by path instead of inlining it', () => {
    const prompt = buildMatterSkillInvocationPrompt({ ...base, mode: 'update' });

    expect(prompt).toContain(`Skill file: ${TEAM_SKILL_FILE}`);
    expect(prompt).toContain('Read that file with your file-reading or shell tools');
    // The lead loads the file itself, so the body must not be pasted in.
    expect(prompt).not.toContain(INLINE_FENCE);
    expect(prompt).not.toContain('## Multiple matters');
  });

  it('inlines the skill body when no team copy could be prepared', () => {
    const prompt = buildMatterSkillInvocationPrompt({
      ...base,
      mode: 'update',
      skillFilePath: null,
      skillMarkdown: '---\nname: matter-dashboard\ndescription: x\n---\n\nEDITED BY THE USER\n',
    });

    expect(prompt).toContain(INLINE_FENCE);
    expect(prompt).toContain('EDITED BY THE USER');
    expect(prompt).not.toContain('Skill file:');
    // Frontmatter is skill-file bookkeeping, not instruction text.
    expect(prompt).not.toContain('description: x');
  });

  it('appends the authoritative schema whenever the copy drifted from the bundled text', () => {
    const drifted = `${MATTER_SKILL_MARKDOWN}\n\n## House rules\nAlways cite the docket.\n`;

    for (const skillFilePath of [TEAM_SKILL_FILE, null]) {
      const prompt = buildMatterSkillInvocationPrompt({
        ...base,
        mode: 'update',
        skillFilePath,
        skillMarkdown: drifted,
      });
      expect(prompt).toContain('Authoritative section schema for this app version');
    }

    expect(buildMatterSkillInvocationPrompt({ ...base, mode: 'update' })).not.toContain(
      'Authoritative section schema for this app version'
    );
  });
});
