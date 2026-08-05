/**
 * Identity of the user-owned skill that carries the matter dashboard workflow.
 * Lives in contracts because lead prompts across the app name it, while the
 * skill's markdown body stays in `core/domain/matterSkillDefinition`.
 */
export const MATTER_SKILL_SLUG = 'matter-dashboard';

export const MATTER_SKILL_DESCRIPTION =
  'Keep a litigation matter dashboard current from the case folder and completed work, through the propose then user-approve flow.';
