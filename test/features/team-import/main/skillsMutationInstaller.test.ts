import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { SkillsMutationInstaller } from '@features/team-import/main/infrastructure/SkillsMutationInstaller';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TeamImportBundleSkill } from '@features/team-import/contracts';
import type { SkillsMutationService } from '@main/services/extensions/skills/SkillsMutationService';

function skill(slug: string): TeamImportBundleSkill {
  return { slug, description: 'demo', files: [{ relativePath: 'SKILL.md', content: 'x' }] };
}

function fakeMutationService() {
  return {
    previewUpsert: vi.fn().mockResolvedValue({ planId: 'plan-1' }),
    applyUpsert: vi.fn().mockResolvedValue(null),
  } as unknown as SkillsMutationService;
}

describe('SkillsMutationInstaller', () => {
  let homeDir: string;
  let projectDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(path.join(tmpdir(), 'skills-installer-'));
    mkdirSync(path.join(homeDir, '.claude', 'skills'), { recursive: true });
    projectDir = mkdtempSync(path.join(tmpdir(), 'skills-installer-project-'));
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe('with a project folder — a team owns its skills', () => {
    it('installs into the project skill root, not the user-wide one', async () => {
      const service = fakeMutationService();
      const installer = new SkillsMutationInstaller(service, homeDir);

      const result = await installer.install(skill('demo-skill'), { projectPath: projectDir });

      expect(result.status).toBe('installed');
      expect(vi.mocked(service.applyUpsert).mock.calls.map(([request]) => request)).toEqual([
        expect.objectContaining({
          scope: 'project',
          rootKind: 'claude',
          projectPath: projectDir,
          folderName: 'demo-skill',
        }),
      ]);
    });

    it('adds the project Codex root only when Codex is set up on this machine', async () => {
      mkdirSync(path.join(homeDir, '.codex'), { recursive: true });
      const service = fakeMutationService();
      const installer = new SkillsMutationInstaller(service, homeDir);

      await installer.install(skill('demo-skill'), { projectPath: projectDir });

      expect(vi.mocked(service.applyUpsert).mock.calls.map(([request]) => request.rootKind)).toEqual(
        ['claude', 'codex']
      );
      expect(
        vi.mocked(service.applyUpsert).mock.calls.every(([request]) => request.scope === 'project')
      ).toBe(true);
    });

    it('still refuses to overwrite a skill the project already has', async () => {
      mkdirSync(path.join(projectDir, '.claude', 'skills', 'demo-skill'), { recursive: true });
      const service = fakeMutationService();
      const installer = new SkillsMutationInstaller(service, homeDir);

      const result = await installer.install(skill('demo-skill'), { projectPath: projectDir });

      expect(result.status).toBe('skipped');
      expect(service.applyUpsert).not.toHaveBeenCalled();
    });

    it('lists the project slugs, not the user-wide ones', async () => {
      mkdirSync(path.join(projectDir, '.claude', 'skills', 'project-skill'), { recursive: true });
      mkdirSync(path.join(homeDir, '.claude', 'skills', 'user-skill'), { recursive: true });
      const installer = new SkillsMutationInstaller(fakeMutationService(), homeDir);

      const slugs = await installer.listExistingSlugs({ projectPath: projectDir });

      expect(slugs.has('project-skill')).toBe(true);
      expect(slugs.has('user-skill')).toBe(false);
    });

    it('does not let two teams collide over a same-named skill', async () => {
      const otherProjectDir = mkdtempSync(path.join(tmpdir(), 'skills-installer-other-'));
      mkdirSync(path.join(projectDir, '.claude', 'skills', 'legal-research'), { recursive: true });
      const service = fakeMutationService();
      const installer = new SkillsMutationInstaller(service, homeDir);

      const result = await installer.install(skill('legal-research'), {
        projectPath: otherProjectDir,
      });

      // The other team already having this slug must not block this one.
      expect(result.status).toBe('installed');
      rmSync(otherProjectDir, { recursive: true, force: true });
    });
  });

  // Without a project folder (a URL import) there is nothing to scope to, so
  // the skills fall back to the user-wide roots.
  it('installs only to the Claude root when Codex is not set up', async () => {
    const service = fakeMutationService();
    const installer = new SkillsMutationInstaller(service, homeDir);

    const result = await installer.install(skill('demo-skill'));

    expect(result.status).toBe('installed');
    expect(vi.mocked(service.applyUpsert).mock.calls.map(([request]) => request.rootKind)).toEqual([
      'claude',
    ]);
  });

  it('installs to both roots when ~/.codex exists', async () => {
    mkdirSync(path.join(homeDir, '.codex'), { recursive: true });
    const service = fakeMutationService();
    const installer = new SkillsMutationInstaller(service, homeDir);

    const result = await installer.install(skill('demo-skill'));

    expect(result.status).toBe('installed');
    expect(vi.mocked(service.applyUpsert).mock.calls.map(([request]) => request.rootKind)).toEqual([
      'claude',
      'codex',
    ]);
  });

  it('skips per root and reports a mixed outcome', async () => {
    mkdirSync(path.join(homeDir, '.codex', 'skills'), { recursive: true });
    mkdirSync(path.join(homeDir, '.claude', 'skills', 'demo-skill'), { recursive: true });
    const service = fakeMutationService();
    const installer = new SkillsMutationInstaller(service, homeDir);

    const result = await installer.install(skill('demo-skill'));

    expect(result.status).toBe('installed');
    expect(result.detail).toContain('~/.codex/skills');
    expect(result.detail).toContain('already existed in ~/.claude/skills');
    expect(vi.mocked(service.applyUpsert).mock.calls.map(([request]) => request.rootKind)).toEqual([
      'codex',
    ]);
  });

  it('reports skipped when the slug exists in every root', async () => {
    mkdirSync(path.join(homeDir, '.claude', 'skills', 'demo-skill'), { recursive: true });
    const service = fakeMutationService();
    const installer = new SkillsMutationInstaller(service, homeDir);

    const result = await installer.install(skill('demo-skill'));

    expect(result).toEqual({
      status: 'skipped',
      detail: 'already exists in ~/.claude/skills',
    });
    expect(service.applyUpsert).not.toHaveBeenCalled();
  });

  it('lists existing slugs as a union across roots', async () => {
    mkdirSync(path.join(homeDir, '.claude', 'skills', 'claude-only'), { recursive: true });
    mkdirSync(path.join(homeDir, '.codex', 'skills', 'codex-only'), { recursive: true });
    const installer = new SkillsMutationInstaller(fakeMutationService(), homeDir);

    const slugs = await installer.listExistingSlugs();

    expect(slugs.has('claude-only')).toBe(true);
    expect(slugs.has('codex-only')).toBe(true);
  });

  it('reports failed with per-root detail when a root install throws', async () => {
    const service = fakeMutationService();
    vi.mocked(service.applyUpsert).mockRejectedValue(new Error('disk full'));
    const installer = new SkillsMutationInstaller(service, homeDir);

    const result = await installer.install(skill('demo-skill'));

    expect(result.status).toBe('failed');
    expect(result.detail).toContain('~/.claude/skills: disk full');
  });
});
