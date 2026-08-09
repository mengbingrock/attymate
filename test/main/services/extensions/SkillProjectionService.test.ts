import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { SkillProjectionService } from '@main/services/extensions/skills/SkillProjectionService';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ResolvedSkillRoot,
  SkillRootsResolver,
} from '@main/services/extensions/skills/SkillRootsResolver';

let tempRoot: string;
let claudeRoot: string;
let codexRoot: string;
let projectRoot: string;
let canonicalDir: string;
let skillsBase: string;

/** Two runtime-branded user roots, the pointers' destinations. */
function createResolver(): SkillRootsResolver {
  const userRoots: ResolvedSkillRoot[] = [
    { scope: 'user', rootKind: 'claude', teamName: null, projectRoot: null, rootPath: claudeRoot },
    { scope: 'user', rootKind: 'codex', teamName: null, projectRoot: null, rootPath: codexRoot },
  ];
  const projectRoots: ResolvedSkillRoot[] = [
    {
      scope: 'project',
      rootKind: 'claude',
      teamName: null,
      projectRoot,
      rootPath: path.join(projectRoot, '.claude', 'skills'),
    },
    {
      scope: 'project',
      rootKind: 'codex',
      teamName: null,
      projectRoot,
      rootPath: path.join(projectRoot, '.codex', 'skills'),
    },
  ];
  return {
    resolve: (options?: string) => (options ? [...userRoots, ...projectRoots] : userRoots),
    resolveUserProjectionRoots: () => userRoots,
  } as unknown as SkillRootsResolver;
}

function createService(): SkillProjectionService {
  return new SkillProjectionService(createResolver(), skillsBase);
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-projection-'));
  claudeRoot = path.join(tempRoot, 'home', '.claude', 'skills');
  codexRoot = path.join(tempRoot, 'home', '.codex', 'skills');
  projectRoot = path.join(tempRoot, 'project');
  skillsBase = path.join(tempRoot, 'appdata', 'skills');
  canonicalDir = path.join(skillsBase, 'library', 'matter-dashboard');
  await fs.mkdir(canonicalDir, { recursive: true });
  await fs.writeFile(path.join(canonicalDir, 'SKILL.md'), '# canonical\n', 'utf8');
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('SkillProjectionService', () => {
  it('points every runtime root at the one canonical copy', async () => {
    const result = await createService().project(canonicalDir, 'matter-dashboard');

    expect(result.targets.map((target) => target.outcome)).toEqual(['linked', 'linked']);
    for (const root of [claudeRoot, codexRoot]) {
      const linkPath = path.join(root, 'matter-dashboard');
      expect((await fs.lstat(linkPath)).isSymbolicLink()).toBe(true);
      // Reading through the pointer must reach the canonical file.
      expect(await fs.readFile(path.join(linkPath, 'SKILL.md'), 'utf8')).toBe('# canonical\n');
    }
  });

  it('projects a running team into its current project instead of user-wide roots', async () => {
    const result = await createService().project(canonicalDir, 'matter-dashboard', {
      projectPath: projectRoot,
    });

    expect(result.targets.map((target) => target.linkPath)).toEqual([
      path.join(projectRoot, '.claude', 'skills', 'matter-dashboard'),
      path.join(projectRoot, '.codex', 'skills', 'matter-dashboard'),
    ]);
    await expect(fs.lstat(path.join(claudeRoot, 'matter-dashboard'))).rejects.toThrow();
    await expect(fs.lstat(path.join(codexRoot, 'matter-dashboard'))).rejects.toThrow();
  });

  it('is idempotent', async () => {
    const service = createService();
    await service.project(canonicalDir, 'matter-dashboard');
    const second = await service.project(canonicalDir, 'matter-dashboard');

    expect(second.targets.every((target) => target.outcome === 'already-linked')).toBe(true);
  });

  it('never overwrites a hand-made skill that already owns the name', async () => {
    const existing = path.join(claudeRoot, 'matter-dashboard');
    await fs.mkdir(existing, { recursive: true });
    await fs.writeFile(path.join(existing, 'SKILL.md'), '# mine\n', 'utf8');

    const result = await createService().project(canonicalDir, 'matter-dashboard');

    const claudeTarget = result.targets.find((target) => target.linkPath === existing);
    expect(claudeTarget?.outcome).toBe('skipped-existing');
    expect(await fs.readFile(path.join(existing, 'SKILL.md'), 'utf8')).toBe('# mine\n');
    // The other root is unaffected by the conflict.
    expect(
      (await fs.lstat(path.join(codexRoot, 'matter-dashboard'))).isSymbolicLink()
    ).toBe(true);
  });

  it('removes only the pointers it installed', async () => {
    // Refusing to remove a replaced pointer is reported as a warning.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = createService();
    await service.project(canonicalDir, 'matter-dashboard');
    // Something else replaces the Claude pointer after we installed it.
    const claudeLink = path.join(claudeRoot, 'matter-dashboard');
    await fs.rm(claudeLink, { recursive: true, force: true });
    await fs.mkdir(claudeLink, { recursive: true });
    await fs.writeFile(path.join(claudeLink, 'SKILL.md'), '# replaced\n', 'utf8');

    await service.release('matter-dashboard', canonicalDir);

    expect(await fs.readFile(path.join(claudeLink, 'SKILL.md'), 'utf8')).toBe('# replaced\n');
    await expect(fs.lstat(path.join(codexRoot, 'matter-dashboard'))).rejects.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('changed since it was created')
    );
    warnSpy.mockRestore();
  });

  it('leaves the canonical files untouched when pointers are released', async () => {
    const service = createService();
    await service.project(canonicalDir, 'matter-dashboard');
    await service.release('matter-dashboard', canonicalDir);

    expect(await fs.readFile(path.join(canonicalDir, 'SKILL.md'), 'utf8')).toBe('# canonical\n');
  });

  it('releases every pointer under a canonical root, for a whole team', async () => {
    const service = createService();
    const teamRoot = path.join(skillsBase, 'teams', 'alpha');
    for (const slug of ['matter-dashboard', 'drafting']) {
      const dir = path.join(teamRoot, slug);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'SKILL.md'), `# ${slug}\n`, 'utf8');
      await service.project(dir, slug);
    }

    await service.releaseUnder(teamRoot);

    for (const slug of ['matter-dashboard', 'drafting']) {
      await expect(fs.lstat(path.join(claudeRoot, slug))).rejects.toThrow();
      await expect(fs.lstat(path.join(codexRoot, slug))).rejects.toThrow();
    }
  });

  it('releases only the stopped run project when a project scope is supplied', async () => {
    const service = createService();
    await service.project(canonicalDir, 'matter-dashboard');
    await service.project(canonicalDir, 'matter-dashboard', { projectPath: projectRoot });

    await service.releaseUnder(path.join(skillsBase, 'library'), { projectPath: projectRoot });

    await expect(
      fs.lstat(path.join(projectRoot, '.claude', 'skills', 'matter-dashboard'))
    ).rejects.toThrow();
    expect((await fs.lstat(path.join(claudeRoot, 'matter-dashboard'))).isSymbolicLink()).toBe(true);
  });

  it('records pointers so a later run can reclaim them', async () => {
    await createService().project(canonicalDir, 'matter-dashboard');

    const raw = await fs.readFile(path.join(skillsBase, 'projections.json'), 'utf8');
    const parsed = JSON.parse(raw) as { projections: { linkPath: string }[] };
    expect(parsed.projections).toHaveLength(2);

    // A fresh instance (app restart) still knows what it owns.
    await createService().release('matter-dashboard', canonicalDir);
    await expect(fs.lstat(path.join(claudeRoot, 'matter-dashboard'))).rejects.toThrow();
  });
});
