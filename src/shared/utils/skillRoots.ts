import type { TeamProviderId } from '@shared/types';
import type { CliInstallationStatus } from '@shared/types';
import type { SkillRootKind } from '@shared/types/extensions';

export type SkillAudience = 'shared' | 'codex';

export interface SkillRootDefinition {
  rootKind: SkillRootKind;
  directoryName: `.${string}`;
  segments: [string, 'skills'];
  audience: SkillAudience;
}

export const SKILL_ROOT_DEFINITIONS: readonly SkillRootDefinition[] = [
  {
    rootKind: 'claude',
    directoryName: '.claude',
    segments: ['.claude', 'skills'],
    audience: 'shared',
  },
  {
    rootKind: 'cursor',
    directoryName: '.cursor',
    segments: ['.cursor', 'skills'],
    audience: 'shared',
  },
  {
    rootKind: 'agents',
    directoryName: '.agents',
    segments: ['.agents', 'skills'],
    audience: 'shared',
  },
  {
    rootKind: 'codex',
    directoryName: '.codex',
    segments: ['.codex', 'skills'],
    audience: 'codex',
  },
] as const;

/**
 * The app's own store. Unlike the entries above it names no CLI directory: its
 * skills are reachable from every runtime because the app points the
 * runtime-branded folders at them (see SkillProjectionService).
 */
export const LIBRARY_SKILL_ROOT_KIND = 'library';

export function isLibrarySkillRootKind(rootKind: SkillRootKind): boolean {
  return rootKind === LIBRARY_SKILL_ROOT_KIND;
}

/** Null for the app library, which is backed by no CLI directory. */
export function getSkillRootDefinition(rootKind: SkillRootKind): SkillRootDefinition | null {
  return SKILL_ROOT_DEFINITIONS.find((definition) => definition.rootKind === rootKind) ?? null;
}

export function formatSkillRootKind(rootKind: SkillRootKind): string {
  return getSkillRootDefinition(rootKind)?.directoryName ?? 'App library';
}

export function getSkillAudience(rootKind: SkillRootKind): SkillAudience {
  // Library skills reach every runtime, so they are shared by definition.
  return getSkillRootDefinition(rootKind)?.audience ?? 'shared';
}

export function getSkillAudienceLabel(rootKind: SkillRootKind): string {
  return getSkillAudience(rootKind) === 'codex' ? 'Codex only' : 'Shared';
}

export function isSkillAvailableForProvider(
  rootKind: SkillRootKind,
  providerId?: TeamProviderId
): boolean {
  return getSkillAudience(rootKind) === 'shared' || providerId === 'codex';
}

export function isCodexSkillOverlayAvailable(
  cliStatus: Pick<CliInstallationStatus, 'flavor' | 'providers'> | null | undefined
): boolean {
  // The Codex skill overlay shipped with the multimodel runtime, which this
  // fork no longer bundles; codex skills install directly to ~/.codex/skills.
  void cliStatus;
  return false;
}
