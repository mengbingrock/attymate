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
  rootPath: '/home/user/.claude/skills',
} as ResolvedSkillRoot;

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
  const base = {
    teamName: 'signal-ops',
    projectPath: '/cases/1234567',
    hasTeammates: true,
    canSpawnTeammates: true,
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

  it('inlines the skill body so runtimes without skill discovery still get it', () => {
    const prompt = buildMatterSkillInvocationPrompt({
      ...base,
      mode: 'update',
      skillMarkdown: '---\nname: matter-dashboard\ndescription: x\n---\n\nEDITED BY THE USER\n',
    });

    expect(prompt).toContain('EDITED BY THE USER');
    // Frontmatter is skill-file bookkeeping, not instruction text.
    expect(prompt).not.toContain('description: x');
  });
});
