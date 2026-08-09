import * as path from 'node:path';

import { getHomeDir, getSkillsBasePath } from '@main/utils/pathDecoder';
import { LIBRARY_SKILL_ROOT_KIND, SKILL_ROOT_DEFINITIONS } from '@shared/utils/skillRoots';

import type { SkillRootKind, SkillScope } from '@shared/types/extensions';

export interface ResolvedSkillRoot {
  scope: SkillScope;
  rootKind: SkillRootKind;
  teamName: string | null;
  projectRoot: string | null;
  rootPath: string;
}

export interface SkillRootsResolveOptions {
  projectPath?: string;
  teamName?: string;
}

const CLI_ROOTS: { rootKind: SkillRootKind; segments: string[] }[] = SKILL_ROOT_DEFINITIONS.map(
  (definition) => ({
    rootKind: definition.rootKind,
    segments: [...definition.segments],
  })
);

/** `<userData>/skills/library` — canonical machine-wide skills. */
export function getLibrarySkillsRootPath(): string {
  return path.join(getSkillsBasePath(), 'library');
}

/** `<userData>/skills/teams/<team>` — canonical skills a team owns and exports. */
export function getTeamSkillsRootPath(teamName: string): string {
  if (
    !teamName ||
    teamName === '.' ||
    teamName === '..' ||
    teamName.startsWith('.') ||
    path.isAbsolute(teamName) ||
    teamName.includes('/') ||
    teamName.includes('\\') ||
    teamName.includes('\0')
  ) {
    throw new Error(`Invalid team name: ${JSON.stringify(teamName)}`);
  }
  return path.join(getSkillsBasePath(), 'teams', teamName);
}

export class SkillRootsResolver {
  /**
   * Accepts a plain project path for the many existing callers that only know
   * about a project, or an options object when a team scope is also in play.
   */
  resolve(options?: string | SkillRootsResolveOptions): ResolvedSkillRoot[] {
    const { projectPath, teamName } =
      typeof options === 'string' ? { projectPath: options, teamName: undefined } : (options ?? {});

    const roots: ResolvedSkillRoot[] = [];
    const homeDir = getHomeDir();

    // The app's own store comes first so its entries win precedence ties over
    // the pointers it installs into the CLI directories.
    roots.push({
      scope: 'library',
      rootKind: LIBRARY_SKILL_ROOT_KIND,
      teamName: null,
      projectRoot: null,
      rootPath: getLibrarySkillsRootPath(),
    });

    if (teamName) {
      roots.push({
        scope: 'team',
        rootKind: LIBRARY_SKILL_ROOT_KIND,
        teamName,
        projectRoot: null,
        rootPath: getTeamSkillsRootPath(teamName),
      });
    }

    for (const def of CLI_ROOTS) {
      roots.push({
        scope: 'user',
        rootKind: def.rootKind,
        teamName: null,
        projectRoot: null,
        rootPath: path.join(homeDir, ...def.segments),
      });
    }

    if (projectPath) {
      for (const def of CLI_ROOTS) {
        roots.push({
          scope: 'project',
          rootKind: def.rootKind,
          teamName: null,
          projectRoot: projectPath,
          rootPath: path.join(projectPath, ...def.segments),
        });
      }
    }

    return roots;
  }

  /** The runtime-branded user directories a canonical skill is pointed into. */
  resolveUserProjectionRoots(): ResolvedSkillRoot[] {
    return this.resolve().filter((root) => root.scope === 'user');
  }
}
