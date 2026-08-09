import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { SkillPlanService } from '@main/services/extensions/skills/SkillPlanService';
import { SkillRootsResolver } from '@main/services/extensions/skills/SkillRootsResolver';
import { SkillScaffoldService } from '@main/services/extensions/skills/SkillScaffoldService';
import { SkillsCatalogService } from '@main/services/extensions/skills/SkillsCatalogService';
import { SkillsMutationService } from '@main/services/extensions/skills/SkillsMutationService';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedSkillRoot } from '@main/services/extensions/skills/SkillRootsResolver';

function createResolver(rootPath: string): SkillRootsResolver {
  const resolver = new SkillRootsResolver();
  vi.spyOn(resolver, 'resolve').mockImplementation(
    (options?: string | { projectPath?: string }): ResolvedSkillRoot[] => {
      const projectPath = typeof options === 'string' ? options : options?.projectPath;
      return [
        {
          scope: 'project',
          rootKind: 'claude',
          teamName: null,
          projectRoot: projectPath ?? rootPath,
          rootPath,
        },
      ];
    }
  );
  return resolver;
}

function createLibraryResolver(rootPath: string): SkillRootsResolver {
  const resolver = new SkillRootsResolver();
  vi.spyOn(resolver, 'resolve').mockReturnValue([
    {
      scope: 'library',
      rootKind: 'library',
      teamName: null,
      projectRoot: null,
      rootPath,
    },
  ]);
  return resolver;
}

/**
 * The pointers into the CLI folders are a side effect of a save, not part of
 * it: stubbing them keeps these tests off the real skill directories.
 */
function createProjectionService() {
  return {
    project: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
  };
}

describe('SkillsMutationService', () => {
  const createdDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(createdDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('applies the reviewed plan and deletes obsolete managed files', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-mutation-'));
    createdDirs.push(projectRoot);

    const skillsRoot = path.join(projectRoot, '.claude', 'skills');
    const skillDir = path.join(skillsRoot, 'demo');
    await fs.mkdir(path.join(skillDir, 'scripts'), { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# old', 'utf8');
    await fs.writeFile(path.join(skillDir, 'scripts', 'README.md'), 'old script', 'utf8');

    const resolver = createResolver(skillsRoot);
    const mutationService = new SkillsMutationService(
      resolver,
      new SkillsCatalogService(resolver),
      new SkillScaffoldService(resolver),
      undefined,
      new SkillPlanService(),
      createProjectionService() as never
    );

    const request = {
      scope: 'project' as const,
      rootKind: 'claude' as const,
      projectPath: projectRoot,
      folderName: 'demo',
      existingSkillId: skillDir,
      files: [{ relativePath: 'SKILL.md', content: '# updated' }],
    };

    const preview = await mutationService.previewUpsert(request);
    await mutationService.applyUpsert({ ...request, reviewPlanId: preview.planId });

    await expect(fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf8')).resolves.toBe('# updated');
    await expect(fs.stat(path.join(skillDir, 'scripts', 'README.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects apply when the reviewed plan is stale', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-mutation-'));
    createdDirs.push(projectRoot);

    const skillsRoot = path.join(projectRoot, '.claude', 'skills');
    const skillDir = path.join(skillsRoot, 'demo');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# old', 'utf8');

    const resolver = createResolver(skillsRoot);
    const mutationService = new SkillsMutationService(
      resolver,
      new SkillsCatalogService(resolver),
      new SkillScaffoldService(resolver),
      undefined,
      new SkillPlanService(),
      createProjectionService() as never
    );

    const request = {
      scope: 'project' as const,
      rootKind: 'claude' as const,
      projectPath: projectRoot,
      folderName: 'demo',
      existingSkillId: skillDir,
      files: [{ relativePath: 'SKILL.md', content: '# updated' }],
    };

    const preview = await mutationService.previewUpsert(request);
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# changed after review', 'utf8');

    await expect(
      mutationService.applyUpsert({ ...request, reviewPlanId: preview.planId })
    ).rejects.toThrow('changed after review');
  });

  it('points the runtime folders at a saved library skill', async () => {
    const appData = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-mutation-lib-'));
    createdDirs.push(appData);

    const libraryRoot = path.join(appData, 'skills', 'library');
    const resolver = createLibraryResolver(libraryRoot);
    const projectionService = createProjectionService();
    const mutationService = new SkillsMutationService(
      resolver,
      new SkillsCatalogService(resolver),
      new SkillScaffoldService(resolver),
      undefined,
      new SkillPlanService(),
      projectionService as never
    );

    const request = {
      scope: 'library' as const,
      rootKind: 'library' as const,
      folderName: 'demo',
      files: [{ relativePath: 'SKILL.md', content: '# demo' }],
    };

    const preview = await mutationService.previewUpsert(request);
    await mutationService.applyUpsert({ ...request, reviewPlanId: preview.planId });

    expect(projectionService.project).toHaveBeenCalledWith(path.join(libraryRoot, 'demo'), 'demo');
  });
});
