import type { ResolvedSkillRoot, SkillRootsResolver } from './SkillRootsResolver';
import type { SkillRootKind, SkillScope } from '@shared/types/extensions';

export interface WritableSkillRootQuery {
  scope: SkillScope;
  rootKind: SkillRootKind;
  projectPath?: string;
  teamName?: string;
}

/**
 * Pick the root a write targets. Shared by the scaffold and mutation services,
 * which each carried an identical private copy.
 */
export function resolveWritableSkillRoot(
  rootsResolver: SkillRootsResolver,
  query: WritableSkillRootQuery
): ResolvedSkillRoot {
  if (query.scope === 'project' && !query.projectPath) {
    throw new Error('projectPath is required for project-scoped skills');
  }
  if (query.scope === 'team' && !query.teamName) {
    throw new Error('teamName is required for team-scoped skills');
  }

  const roots = rootsResolver.resolve({
    projectPath: query.projectPath,
    teamName: query.teamName,
  });
  const match = roots.find(
    (root) => root.scope === query.scope && root.rootKind === query.rootKind
  );
  if (!match) {
    throw new Error('Requested skill root is unavailable');
  }
  return match;
}
