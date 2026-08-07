import { TEAM_IMPORT_BUNDLE_SCHEMA } from '@features/team-import/contracts';
import {
  buildClaudeAgentDefinitionMarkdown,
  extractTeamImportMarkdownBody,
  LEAD_PREFIX,
  MEMBER_PREFIX,
  parseTeamImportFrontmatter,
  validateImportedMemberName,
} from '@features/team-import/core';

import type { TeamExportWarning } from '../../contracts';
import type {
  TeamImportBundle,
  TeamImportBundleMember,
  TeamImportBundleSkill,
} from '@features/team-import/contracts';

/**
 * The importer's own ceilings (`teamImportBundlePolicy`). Exporting past them
 * would produce a bundle that silently loses members or skills on the way back
 * in, so the export reports what it dropped instead.
 */
export const TEAM_EXPORT_LIMITS = {
  maxMembers: 20,
  maxSkills: 20,
} as const;

/** A team member as persisted by the app, from any of its stores. */
export interface TeamExportMemberSource {
  name: string;
  /** members.meta.json role text. */
  role?: string;
  /** members.meta.json workflow — a pointer with absolute paths, last resort. */
  workflow?: string;
  /** members.meta.json skill slugs: the durable record of the assignment. */
  skills?: string[];
  agentType?: string;
  /** agents/<name>/AGENT.md, when the team has one. */
  agentMarkdown?: string;
  /** agents/<name>/claude-agent-definition.md, when the team has one. */
  agentDefinitionMarkdown?: string;
}

export interface TeamExportSource {
  teamName: string;
  description?: string;
  /** team.meta.json prompt — becomes the bundle's lead prompt and CLAUDE.md. */
  leadPrompt?: string;
  /**
   * Slugs found in the team's own project skill root. That folder is the team's
   * skill library, so these ship whether or not a member happens to name them —
   * thin per-member attribution must not silently drop a team's skills.
   */
  projectSkillSlugs?: string[];
  members: TeamExportMemberSource[];
}

export interface TeamExportMembersResult {
  members: TeamImportBundleMember[];
  /** Skill slugs the exported members reference, deduped and ordered. */
  referencedSlugs: string[];
  warnings: TeamExportWarning[];
}

/** `## Workflow` section of an AGENT.md, which holds the real instructions. */
function extractAgentMarkdownWorkflow(agentMarkdown: string): string | null {
  const match = /^##\s+Workflow\s*$([\s\S]*)/m.exec(agentMarkdown);
  return match ? match[1].trim() || null : null;
}

/**
 * members.meta.json workflows are pointers into this machine's team directory
 * ("read /Users/…/.claude/teams/<team>/agents/<name>/AGENT.md"), plus the
 * collaboration preamble the importer re-adds itself. Neither travels.
 */
export function stripMachineSpecificWorkflow(workflow: string): string {
  const withoutPrefixes = workflow.replace(MEMBER_PREFIX, '').replace(LEAD_PREFIX, '');
  return withoutPrefixes
    .split(/\r?\n/)
    .filter((line) => !/\.claude[/\\]teams[/\\]/.test(line))
    .join('\n')
    .trim();
}

function readMemberWorkflow(member: TeamExportMemberSource): string {
  const fromDefinition = member.agentDefinitionMarkdown
    ? extractTeamImportMarkdownBody(member.agentDefinitionMarkdown)
    : '';
  if (fromDefinition) return fromDefinition;

  const fromAgentMarkdown = member.agentMarkdown
    ? extractAgentMarkdownWorkflow(member.agentMarkdown)
    : null;
  if (fromAgentMarkdown) return fromAgentMarkdown;

  return member.workflow ? stripMachineSpecificWorkflow(member.workflow) : '';
}

function readMemberRole(member: TeamExportMemberSource, definitionRole?: string): string {
  return (definitionRole ?? member.role ?? '').trim();
}

/**
 * Projects persisted team state onto importable members.
 *
 * Prefers each agent's own `claude-agent-definition.md` — it is already the
 * Claude subagent format the importer reads — and synthesizes an equivalent
 * from `members.meta.json` for teams created in the UI, which have no agents
 * directory. Memory files are deliberately never carried: they accumulate
 * matter-specific facts that must not travel in a reusable package.
 */
export function buildTeamExportMembers(source: TeamExportSource): TeamExportMembersResult {
  const warnings: TeamExportWarning[] = [];
  const members: TeamImportBundleMember[] = [];
  const referencedSlugs: string[] = [];
  const seen = new Set<string>();

  for (const member of source.members) {
    const name = member.name?.trim() ?? '';
    const invalid = validateImportedMemberName(name);
    if (invalid) {
      warnings.push({
        code: 'memberSkipped',
        name: name || '(unnamed)',
        reason: `the importer rejects this name (${invalid})`,
      });
      continue;
    }
    if (seen.has(name.toLowerCase())) {
      warnings.push({ code: 'memberSkipped', name, reason: 'duplicate member name' });
      continue;
    }

    const frontmatter = member.agentDefinitionMarkdown
      ? parseTeamImportFrontmatter(member.agentDefinitionMarkdown)
      : { skills: [] as string[], description: undefined as string | undefined };
    // members.meta.json is the record; the agent markdown is a copy of it that
    // older teams may be the only carrier of.
    const memberSkills = member.skills?.length ? member.skills : frontmatter.skills;
    const workflow = readMemberWorkflow(member);
    if (!workflow) {
      warnings.push({
        code: 'memberSkipped',
        name,
        reason: 'no workflow text found to export',
      });
      continue;
    }

    if (members.length >= TEAM_EXPORT_LIMITS.maxMembers) {
      warnings.push({
        code: 'memberLimitExceeded',
        dropped: source.members.length - members.length,
        limit: TEAM_EXPORT_LIMITS.maxMembers,
      });
      break;
    }

    seen.add(name.toLowerCase());
    for (const slug of memberSkills) {
      if (!referencedSlugs.includes(slug)) referencedSlugs.push(slug);
    }
    // Deliberately NO model or provider: the bundle is model-agnostic. A
    // member's model is runtime configuration of the machine that exported it
    // (a codex team exported after a Claude relaunch was pinning every member
    // to claude-sonnet-5, silently overriding the importer's provider choice).
    // Roles, workflows, and skills are the portable substance; the importer's
    // team picks models from whatever provider it launches with.
    members.push({
      name,
      role: readMemberRole(member, frontmatter.description),
      workflow,
      skills: memberSkills,
      memoryFiles: [],
    });
  }

  // The team's own skill folder ships in full, even when no member names its
  // slugs — that omission is exactly what made an imported team export zero
  // skills before.
  for (const slug of source.projectSkillSlugs ?? []) {
    if (!referencedSlugs.includes(slug)) referencedSlugs.push(slug);
  }

  return { members, referencedSlugs, warnings };
}

export interface TeamExportBundleResult {
  bundle: TeamImportBundle;
  warnings: TeamExportWarning[];
}

/** Combines projected members with their resolved skills into the bundle. */
export function assembleTeamExportBundle(
  source: TeamExportSource,
  membersResult: TeamExportMembersResult,
  resolvedSkills: readonly TeamImportBundleSkill[]
): TeamExportBundleResult {
  const warnings = [...membersResult.warnings];
  let skills = [...resolvedSkills];
  if (skills.length > TEAM_EXPORT_LIMITS.maxSkills) {
    warnings.push({
      code: 'skillLimitExceeded',
      dropped: skills.length - TEAM_EXPORT_LIMITS.maxSkills,
      limit: TEAM_EXPORT_LIMITS.maxSkills,
    });
    skills = skills.slice(0, TEAM_EXPORT_LIMITS.maxSkills);
  }

  const exportedSlugs = new Set(skills.map((skill) => skill.slug));
  const members = membersResult.members.map((member) => ({
    ...member,
    // The importer prunes dangling references anyway; dropping them here keeps
    // the emitted agent markdown honest about what the bundle actually ships.
    skills: member.skills.filter((slug) => exportedSlugs.has(slug)),
  }));

  return {
    bundle: {
      schema: TEAM_IMPORT_BUNDLE_SCHEMA,
      team: {
        name: source.teamName,
        ...(source.description?.trim() ? { description: source.description.trim() } : {}),
        ...(source.leadPrompt?.trim() ? { leadPrompt: source.leadPrompt.trim() } : {}),
      },
      members,
      skills,
    },
    warnings,
  };
}

export interface TeamExportFile {
  relativePath: string;
  content: string;
}

/**
 * The files an export writes. The bundle JSON is what re-imports with full
 * fidelity; the flat `agents/` + `skills/` layout is what the folder scanner
 * and other tools can still read if the bundle is removed.
 *
 * Every path is visible and provider-neutral: skills live in `skills/`, not a
 * dot-hidden `.claude/skills/`, and the lead prompt is a root `CLAUDE.md`. A
 * package a user shares should be browsable in a file manager, and its layout
 * should not brand a model-agnostic team with one runtime's folder names —
 * runtime-specific roots (`.claude/`, `.codex/`) belong to the project folder
 * the importer installs into, never to the package.
 */
export function buildTeamExportFiles(bundle: TeamImportBundle): TeamExportFile[] {
  const files: TeamExportFile[] = [
    {
      relativePath: 'team-import-bundle.json',
      content: `${JSON.stringify(bundle, null, 2)}\n`,
    },
  ];

  for (const member of bundle.members) {
    files.push({
      relativePath: `agents/${member.name}.md`,
      content: buildClaudeAgentDefinitionMarkdown(member),
    });
  }

  for (const skill of bundle.skills) {
    for (const file of skill.files) {
      files.push({
        relativePath: `skills/${skill.slug}/${file.relativePath}`,
        content: file.content,
      });
    }
  }

  if (bundle.team.leadPrompt?.trim()) {
    // TEAM.md, not CLAUDE.md: even the file name must not brand the package
    // with one runtime. The scanner reads TEAM.md first and still accepts the
    // CLAUDE.md names for folders that predate this layout.
    files.push({
      relativePath: 'TEAM.md',
      content: `${bundle.team.leadPrompt.trim()}\n`,
    });
  }

  files.push({ relativePath: 'README.md', content: buildExportReadme(bundle) });
  return files;
}

function buildExportReadme(bundle: TeamImportBundle): string {
  const skillList = bundle.skills.length
    ? bundle.skills.map((skill) => `- ${skill.slug}`).join('\n')
    : '- (none referenced by these agents)';
  return [
    `# ${bundle.team.name}`,
    '',
    bundle.team.description?.trim() ?? 'An exported agent team.',
    '',
    '## Import it',
    '',
    'In Agent Teams: **Import team**, choose **Folder**, and select this directory.',
    '`team-import-bundle.json` is read directly, so the members, their roles, and the',
    'skills below come back exactly as exported — no model parse involved.',
    '',
    `## Agents (${bundle.members.length})`,
    '',
    bundle.members.map((member) => `- ${member.name} — ${member.role || 'member'}`).join('\n'),
    '',
    '## Skills',
    '',
    skillList,
    '',
    '## Not included',
    '',
    'Agent memory, matter data, tasks, and message history stay on the machine that',
    'exported this team — they describe one live case, not a reusable team.',
    '',
  ].join('\n');
}
