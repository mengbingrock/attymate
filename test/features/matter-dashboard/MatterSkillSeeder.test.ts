import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  MATTER_SKILL_MARKDOWN,
  MATTER_SKILL_SLUG,
} from '@features/matter-dashboard/core/domain/matterSkillDefinition';
import { MatterSkillSeeder } from '@features/matter-dashboard/main';
import { SkillStore } from '@main/services/extensions/skills/SkillStore';
import { setAppDataBasePath } from '@main/utils/pathDecoder';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SkillProjectionService } from '@main/services/extensions/skills/SkillProjectionService';
import type { SkillsMutationService } from '@main/services/extensions/skills/SkillsMutationService';

let appData: string;
let homeDir: string;
let store: SkillStore;

/** The exact v1 bundled markdown, byte-for-byte (hash-gate fixture). */
const V1_SKILL_MARKDOWN = await fs.readFile(
  path.join(__dirname, 'fixtures', 'matter-skill-v1.md'),
  'utf8'
);

const EDITED_SKILL_MARKDOWN = `${MATTER_SKILL_MARKDOWN}\n\n## House rules\nAlways cite the docket.\n`;

/** Stands in for the real mutation service, writing the files it is given. */
function createMutationService(): SkillsMutationService & {
  applyUpsert: ReturnType<typeof vi.fn>;
} {
  const applyUpsert = vi.fn(async (request: Record<string, unknown>) => {
    // The seeder must target the model-agnostic library, never a CLI root.
    expect(request.scope).toBe('library');
    expect(request.rootKind).toBe('library');
    const skillDir = store.resolveLibrarySkillDir(String(request.folderName));
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

function createProjectionService(): SkillProjectionService & {
  project: ReturnType<typeof vi.fn>;
} {
  return {
    project: vi.fn().mockResolvedValue({ slug: MATTER_SKILL_SLUG, canonicalDir: '', targets: [] }),
    release: vi.fn().mockResolvedValue(undefined),
  } as unknown as SkillProjectionService & { project: ReturnType<typeof vi.fn> };
}

function createSeeder(
  mutationService: SkillsMutationService = createMutationService(),
  projectionService: SkillProjectionService = createProjectionService()
): MatterSkillSeeder {
  return new MatterSkillSeeder(mutationService, store, projectionService, homeDir);
}

function legacySkillDir(runtimeDir: '.claude' | '.codex'): string {
  return path.join(homeDir, runtimeDir, 'skills', MATTER_SKILL_SLUG);
}

async function writeLegacyCopy(runtimeDir: '.claude' | '.codex', content: string): Promise<void> {
  const dir = legacySkillDir(runtimeDir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), content, 'utf8');
}

async function writeLibraryCopy(content: string): Promise<void> {
  const dir = store.resolveLibrarySkillDir(MATTER_SKILL_SLUG);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), content, 'utf8');
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  appData = await fs.mkdtemp(path.join(os.tmpdir(), 'matter-skill-appdata-'));
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matter-skill-home-'));
  setAppDataBasePath(appData);
  store = new SkillStore();
});

afterEach(async () => {
  setAppDataBasePath(null);
  await Promise.all(
    [appData, homeDir].map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe('MatterSkillSeeder', () => {
  it('writes the skill into the app library when it is missing', async () => {
    const mutationService = createMutationService();
    const seeder = createSeeder(mutationService);

    await seeder.seed();

    expect(seeder.getPrimarySkillFilePath()).toBe(
      path.join(appData, 'skills', 'library', MATTER_SKILL_SLUG, 'SKILL.md')
    );
    const content = await fs.readFile(seeder.getPrimarySkillFilePath(), 'utf8');
    expect(content).toContain(`name: ${MATTER_SKILL_SLUG}`);
    expect(mutationService.applyUpsert).toHaveBeenCalledTimes(1);
    // One canonical copy only — no runtime-branded path in the store.
    expect(path.relative(appData, seeder.getPrimarySkillFilePath())).not.toMatch(/claude|codex/i);
  });

  it('points the runtime skill folders at the library copy', async () => {
    const projectionService = createProjectionService();

    await createSeeder(createMutationService(), projectionService).seed();

    expect(projectionService.project).toHaveBeenCalledWith(
      store.resolveLibrarySkillDir(MATTER_SKILL_SLUG),
      MATTER_SKILL_SLUG
    );
  });

  it('adopts an edited legacy Claude copy as the library seed', async () => {
    await writeLegacyCopy('.claude', EDITED_SKILL_MARKDOWN);
    const seeder = createSeeder();

    await seeder.seed();

    await expect(seeder.readInstalledMarkdown()).resolves.toBe(EDITED_SKILL_MARKDOWN);
    // The old copy is gone so a pointer can take its place.
    expect(await exists(legacySkillDir('.claude'))).toBe(false);
  });

  it('discards a pristine legacy copy instead of adopting it', async () => {
    await writeLegacyCopy('.claude', V1_SKILL_MARKDOWN);
    const seeder = createSeeder();

    await seeder.seed();

    await expect(seeder.readInstalledMarkdown()).resolves.toBe(MATTER_SKILL_MARKDOWN);
    expect(await exists(legacySkillDir('.claude'))).toBe(false);
  });

  it('sets a second edited legacy copy aside instead of dropping the edits', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const codexEdit = `${MATTER_SKILL_MARKDOWN}\n\n## Codex only\nSkip settlement.\n`;
    await writeLegacyCopy('.claude', EDITED_SKILL_MARKDOWN);
    await writeLegacyCopy('.codex', codexEdit);
    const seeder = createSeeder();

    await seeder.seed();

    // The Claude root is read first, so its edit becomes the library seed.
    await expect(seeder.readInstalledMarkdown()).resolves.toBe(EDITED_SKILL_MARKDOWN);
    const superseded = `${legacySkillDir('.codex')}.superseded`;
    await expect(fs.readFile(path.join(superseded, 'SKILL.md'), 'utf8')).resolves.toBe(codexEdit);
    expect(await exists(legacySkillDir('.codex'))).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[Feature:Matter:SkillSeeder]'),
      expect.stringContaining('superseded')
    );
    warn.mockRestore();
  });

  it('never overwrites an edited library copy — the user owns it', async () => {
    await writeLibraryCopy('MY OWN VERSION\n');
    const mutationService = createMutationService();
    const seeder = createSeeder(mutationService);

    await seeder.seed();

    expect(mutationService.applyUpsert).not.toHaveBeenCalled();
    await expect(seeder.readInstalledMarkdown()).resolves.toBe('MY OWN VERSION\n');
  });

  it('upgrades a pristine older library seed in place (hash-gated)', async () => {
    await writeLibraryCopy(V1_SKILL_MARKDOWN);
    const mutationService = createMutationService();
    const seeder = createSeeder(mutationService);

    await seeder.seed();

    expect(mutationService.applyUpsert).toHaveBeenCalledTimes(1);
    const upgraded = await fs.readFile(seeder.getPrimarySkillFilePath(), 'utf8');
    expect(upgraded).toContain('## Multiple matters');
    expect(upgraded).toContain('settlement');
  });

  it('reports no installed markdown before seeding has run', async () => {
    await expect(createSeeder().readInstalledMarkdown()).resolves.toBeNull();
  });

  it('survives a mutation service failure so refresh can fall back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const mutationService = {
      previewUpsert: vi.fn().mockRejectedValue(new Error('disk full')),
      applyUpsert: vi.fn(),
    } as unknown as SkillsMutationService;

    await expect(createSeeder(mutationService).seed()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
