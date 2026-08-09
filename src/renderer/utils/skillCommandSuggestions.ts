import { getSkillAudienceLabel, isSkillAvailableForProvider } from '@shared/utils/skillRoots';
import { isSupportedSlashCommandName } from '@shared/utils/slashCommands';

import type { MentionSuggestion } from '@renderer/types/mention';
import type { TeamProviderId } from '@shared/types';
import type { SkillCatalogItem, SkillScope } from '@shared/types/extensions';
import type { KnownSlashCommandDefinition } from '@shared/utils/slashCommands';

/**
 * Narrowest home wins a slash-name collision: a project skill beats a team
 * skill, which beats the app library, which beats the personal CLI folder.
 */
const SKILL_SCOPE_PRECEDENCE: readonly SkillScope[] = ['project', 'team', 'library', 'user'];

function formatSkillScopeLabel(skill: SkillCatalogItem): string {
  switch (skill.scope) {
    case 'project':
      return 'Project skill';
    case 'team':
      return skill.teamName ? `Team skill (${skill.teamName})` : 'Team skill';
    case 'library':
      return 'Library skill';
    default:
      return 'Personal skill';
  }
}

function orderSkillsForProvider(
  projectSkills: readonly SkillCatalogItem[],
  otherSkills: readonly SkillCatalogItem[],
  providerId?: TeamProviderId
): SkillCatalogItem[] {
  const visibleSkills = [...projectSkills, ...otherSkills].filter((skill) =>
    isSkillAvailableForProvider(skill.rootKind, providerId)
  );
  const groups = SKILL_SCOPE_PRECEDENCE.map((scope) =>
    visibleSkills.filter((skill) => skill.scope === scope)
  );

  if (providerId !== 'codex') {
    return groups.flat();
  }

  const isCodexOnly = (skill: SkillCatalogItem): boolean => skill.rootKind === 'codex';
  return groups.flatMap((group) => [
    ...group.filter(isCodexOnly),
    ...group.filter((skill) => !isCodexOnly(skill)),
  ]);
}

export function buildSlashCommandSuggestions(
  builtIns: readonly KnownSlashCommandDefinition[],
  projectSkills: readonly SkillCatalogItem[],
  otherSkills: readonly SkillCatalogItem[],
  providerId?: TeamProviderId
): MentionSuggestion[] {
  const builtInNames = new Set(builtIns.map((command) => command.name.trim().toLowerCase()));
  const builtInSuggestions: MentionSuggestion[] = builtIns.map((command) => ({
    id: `command:${command.name}`,
    name: command.name,
    command: command.command,
    description: command.description,
    subtitle: command.description,
    type: 'command',
  }));

  const seenSkillNames = new Set<string>();
  const skillSuggestions: MentionSuggestion[] = [];
  for (const skill of orderSkillsForProvider(projectSkills, otherSkills, providerId)) {
    const normalizedFolderName = skill.folderName.trim().toLowerCase();
    if (
      !skill.isValid ||
      !normalizedFolderName ||
      !isSupportedSlashCommandName(normalizedFolderName) ||
      builtInNames.has(normalizedFolderName) ||
      seenSkillNames.has(normalizedFolderName)
    ) {
      continue;
    }

    seenSkillNames.add(normalizedFolderName);
    skillSuggestions.push({
      id: `skill:${skill.id}`,
      name: skill.folderName,
      command: `/${normalizedFolderName}`,
      description: skill.description,
      subtitle: `${formatSkillScopeLabel(skill)} - ${getSkillAudienceLabel(skill.rootKind)}`,
      searchText: `${skill.name} ${skill.folderName}`,
      type: 'skill',
    });
  }

  return [...builtInSuggestions, ...skillSuggestions];
}
