import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { MATTER_SKILL_SLUG } from '@features/matter-dashboard/core/domain/matterSkillDefinition';
import { MatterSkillSeeder } from '@features/matter-dashboard/main';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SkillsMutationService } from '@main/services/extensions/skills/SkillsMutationService';

let homeDir: string;

/** Stands in for the real mutation service, writing the files it is given. */
function createMutationService(): SkillsMutationService & {
  applyUpsert: ReturnType<typeof vi.fn>;
} {
  const applyUpsert = vi.fn(async (request: Record<string, unknown>) => {
    const rootDir = request.rootKind === 'codex' ? '.codex' : '.claude';
    const skillDir = path.join(homeDir, rootDir, 'skills', String(request.folderName));
    await fs.mkdir(skillDir, { recursive: true });
    for (const file of request.files as { relativePath: string; content: string }[]) {
      await fs.writeFile(path.join(skillDir, file.relativePath), file.content, 'utf8');
    }
    return null;
  });
  return {
    previewUpsert: vi.fn().mockResolvedValue({ planId: 'plan-1' }),
    applyUpsert,
  } as unknown as SkillsMutationService & { applyUpsert: ReturnType<typeof vi.fn> };
}

beforeEach(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matter-skill-seed-'));
});

afterEach(async () => {
  await fs.rm(homeDir, { recursive: true, force: true });
});

describe('MatterSkillSeeder', () => {
  it('writes the skill into the Claude root when it is missing', async () => {
    const mutationService = createMutationService();
    const seeder = new MatterSkillSeeder(mutationService, homeDir);

    await seeder.seed();

    const content = await fs.readFile(seeder.getPrimarySkillFilePath(), 'utf8');
    expect(content).toContain(`name: ${MATTER_SKILL_SLUG}`);
    expect(mutationService.applyUpsert).toHaveBeenCalledTimes(1);
  });

  it('also seeds the Codex root, but only when Codex is set up', async () => {
    await fs.mkdir(path.join(homeDir, '.codex'), { recursive: true });
    const mutationService = createMutationService();

    await new MatterSkillSeeder(mutationService, homeDir).seed();

    expect(mutationService.applyUpsert).toHaveBeenCalledTimes(2);
    await expect(
      fs.readFile(path.join(homeDir, '.codex', 'skills', MATTER_SKILL_SLUG, 'SKILL.md'), 'utf8')
    ).resolves.toContain('Matter dashboard');
  });

  it('never overwrites an existing skill — the user owns it', async () => {
    const skillDir = path.join(homeDir, '.claude', 'skills', MATTER_SKILL_SLUG);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'MY OWN VERSION\n', 'utf8');
    const mutationService = createMutationService();
    const seeder = new MatterSkillSeeder(mutationService, homeDir);

    await seeder.seed();

    expect(mutationService.applyUpsert).not.toHaveBeenCalled();
    await expect(fs.readFile(seeder.getPrimarySkillFilePath(), 'utf8')).resolves.toBe(
      'MY OWN VERSION\n'
    );
    await expect(seeder.readInstalledMarkdown()).resolves.toBe('MY OWN VERSION\n');
  });

  it('reports no installed markdown before seeding has run', async () => {
    const seeder = new MatterSkillSeeder(createMutationService(), homeDir);

    await expect(seeder.readInstalledMarkdown()).resolves.toBeNull();
  });

  it('survives a mutation service failure so refresh can fall back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const mutationService = {
      previewUpsert: vi.fn().mockRejectedValue(new Error('disk full')),
      applyUpsert: vi.fn(),
    } as unknown as SkillsMutationService;

    await expect(new MatterSkillSeeder(mutationService, homeDir).seed()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
