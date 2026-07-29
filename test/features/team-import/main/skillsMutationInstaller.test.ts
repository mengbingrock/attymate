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

  beforeEach(() => {
    homeDir = mkdtempSync(path.join(tmpdir(), 'skills-installer-'));
    mkdirSync(path.join(homeDir, '.claude', 'skills'), { recursive: true });
  });

  afterEach(() => rmSync(homeDir, { recursive: true, force: true }));

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
