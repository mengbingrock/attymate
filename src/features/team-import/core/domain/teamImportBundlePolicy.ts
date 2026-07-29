import { TEAM_IMPORT_BUNDLE_SCHEMA } from '@features/team-import/contracts';

import { suggestTeamImportName, validateImportedMemberName } from './teamImportPolicy';

import type {
  TeamImportBundle,
  TeamImportBundleFile,
  TeamImportBundleMember,
  TeamImportBundleSkill,
  TeamImportWarning,
} from '@features/team-import/contracts';

export const TEAM_IMPORT_BUNDLE_LIMITS = {
  maxMembers: 20,
  maxSkills: 20,
  maxMemoryFilesPerMember: 30,
  maxFilesPerSkill: 30,
  maxFileBytes: 64 * 1024,
  maxWorkflowBytes: 48 * 1024,
  maxTotalBytes: 2 * 1024 * 1024,
} as const;

export interface ParsedTeamImportBundle {
  bundle: TeamImportBundle | null;
  warnings: TeamImportWarning[];
  blockingErrors: string[];
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * Model output is not trusted to be a bare JSON document: accept raw JSON, a
 * fenced ```json block, or JSON embedded in prose (first "{" to last "}").
 */
export function extractJsonObjectText(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n\s*```/.exec(trimmed);
  if (fenced && fenced[1].trim().startsWith('{')) return fenced[1].trim();
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first === -1 || last <= first) return null;
  return trimmed.slice(first, last + 1);
}

export function sanitizeBundleRelativePath(relativePath: string): string | null {
  const normalized = relativePath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.length > 256) return null;
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return null;
  const segments = normalized.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') return null;
    if (!/^[\w][\w.\- ]*$/.test(segment) || segment.endsWith('.') || segment.endsWith(' ')) {
      return null;
    }
  }
  return segments.join('/');
}

function normalizeSlug(value: string): string {
  return suggestTeamImportName(value);
}

interface BudgetContext {
  totalBytes: number;
  warnings: TeamImportWarning[];
}

function takeBundleFiles(
  rawFiles: unknown,
  maxFiles: number,
  context: BudgetContext
): TeamImportBundleFile[] {
  if (!Array.isArray(rawFiles)) return [];
  const files: TeamImportBundleFile[] = [];
  const seenPaths = new Set<string>();
  for (const rawFile of rawFiles) {
    if (files.length >= maxFiles) {
      context.warnings.push({
        code: 'bundleFileDropped',
        path: '…',
        reason: `more than ${maxFiles} files`,
      });
      break;
    }
    if (!rawFile || typeof rawFile !== 'object') continue;
    const candidate = rawFile as Record<string, unknown>;
    if (typeof candidate.relativePath !== 'string' || typeof candidate.content !== 'string') {
      continue;
    }
    const relativePath = sanitizeBundleRelativePath(candidate.relativePath);
    if (!relativePath) {
      context.warnings.push({
        code: 'bundleFileDropped',
        path: candidate.relativePath.slice(0, 120),
        reason: 'unsafe path',
      });
      continue;
    }
    if (seenPaths.has(relativePath.toLowerCase())) continue;
    const bytes = byteLength(candidate.content);
    if (bytes > TEAM_IMPORT_BUNDLE_LIMITS.maxFileBytes) {
      context.warnings.push({ code: 'bundleFileDropped', path: relativePath, reason: 'too large' });
      continue;
    }
    if (context.totalBytes + bytes > TEAM_IMPORT_BUNDLE_LIMITS.maxTotalBytes) {
      context.warnings.push({
        code: 'bundleFileDropped',
        path: relativePath,
        reason: 'bundle size limit reached',
      });
      continue;
    }
    context.totalBytes += bytes;
    seenPaths.add(relativePath.toLowerCase());
    files.push({ relativePath, content: candidate.content });
  }
  return files;
}

const AGENT_DEFINITION_PERMISSION_MODES = new Set([
  'default',
  'acceptEdits',
  'auto',
  'dontAsk',
  'bypassPermissions',
  'plan',
  'manual',
]);
const AGENT_DEFINITION_MEMORY_SCOPES = new Set(['user', 'project', 'local'] as const);
const AGENT_DEFINITION_MAX_LIST_ITEMS = 40;
const AGENT_DEFINITION_MAX_HOOKS_BYTES = 8 * 1024;

function takeAgentDefinitionList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = [
    ...new Set(
      value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0 && entry.length <= 128)
    ),
  ].slice(0, AGENT_DEFINITION_MAX_LIST_ITEMS);
  return items.length > 0 ? items : undefined;
}

/**
 * Normalize the optional Claude Code subagent-definition frontmatter carried
 * on a member. Everything is best-effort: unknown or malformed fields are
 * dropped silently so a noisy model answer can never block the member.
 */
function parseAgentDefinition(raw: unknown): TeamImportBundleMember['agentDefinition'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const candidate = raw as Record<string, unknown>;
  const definition: NonNullable<TeamImportBundleMember['agentDefinition']> = {};
  const tools = takeAgentDefinitionList(candidate.tools);
  if (tools) definition.tools = tools;
  const disallowedTools = takeAgentDefinitionList(candidate.disallowedTools);
  if (disallowedTools) definition.disallowedTools = disallowedTools;
  if (typeof candidate.model === 'string' && candidate.model.trim()) {
    definition.model = candidate.model.trim().slice(0, 64);
  }
  if (
    typeof candidate.permissionMode === 'string' &&
    AGENT_DEFINITION_PERMISSION_MODES.has(candidate.permissionMode.trim())
  ) {
    definition.permissionMode = candidate.permissionMode.trim();
  }
  if (
    typeof candidate.maxTurns === 'number' &&
    Number.isInteger(candidate.maxTurns) &&
    candidate.maxTurns > 0 &&
    candidate.maxTurns <= 1000
  ) {
    definition.maxTurns = candidate.maxTurns;
  }
  const skills = takeAgentDefinitionList(candidate.skills);
  if (skills) definition.skills = skills.map(normalizeSlug).filter(Boolean);
  const mcpServers = takeAgentDefinitionList(candidate.mcpServers);
  if (mcpServers) definition.mcpServers = mcpServers;
  if (
    candidate.hooks &&
    typeof candidate.hooks === 'object' &&
    !Array.isArray(candidate.hooks) &&
    byteLength(JSON.stringify(candidate.hooks)) <= AGENT_DEFINITION_MAX_HOOKS_BYTES
  ) {
    definition.hooks = candidate.hooks as Record<string, unknown>;
  }
  if (
    typeof candidate.memory === 'string' &&
    AGENT_DEFINITION_MEMORY_SCOPES.has(candidate.memory as 'user' | 'project' | 'local')
  ) {
    definition.memory = candidate.memory as 'user' | 'project' | 'local';
  }
  return Object.keys(definition).length > 0 ? definition : undefined;
}

function parseMembers(rawMembers: unknown, context: BudgetContext): TeamImportBundleMember[] {
  if (!Array.isArray(rawMembers)) return [];
  const members: TeamImportBundleMember[] = [];
  const seenNames = new Set<string>();
  for (const rawMember of rawMembers) {
    if (!rawMember || typeof rawMember !== 'object') continue;
    const candidate = rawMember as Record<string, unknown>;
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
    if (members.length >= TEAM_IMPORT_BUNDLE_LIMITS.maxMembers) {
      context.warnings.push({
        code: 'bundleMemberDropped',
        name: name || '…',
        reason: `more than ${TEAM_IMPORT_BUNDLE_LIMITS.maxMembers} members`,
      });
      continue;
    }
    if (!name || validateImportedMemberName(name)) {
      context.warnings.push({
        code: 'bundleMemberDropped',
        name: name.slice(0, 64) || '(unnamed)',
        reason: 'invalid or reserved member name',
      });
      continue;
    }
    if (seenNames.has(name.toLowerCase())) {
      context.warnings.push({ code: 'bundleMemberDropped', name, reason: 'duplicate member name' });
      continue;
    }
    let workflow = typeof candidate.workflow === 'string' ? candidate.workflow.trim() : '';
    if (byteLength(workflow) > TEAM_IMPORT_BUNDLE_LIMITS.maxWorkflowBytes) {
      workflow = workflow.slice(0, TEAM_IMPORT_BUNDLE_LIMITS.maxWorkflowBytes);
    }
    if (!workflow) {
      context.warnings.push({ code: 'bundleMemberDropped', name, reason: 'empty workflow' });
      continue;
    }
    const skills = Array.isArray(candidate.skills)
      ? [
          ...new Set(
            candidate.skills
              .filter((skill): skill is string => typeof skill === 'string')
              .map(normalizeSlug)
              .filter(Boolean)
          ),
        ]
      : [];
    seenNames.add(name.toLowerCase());
    const agentDefinition = parseAgentDefinition(candidate.agentDefinition);
    members.push({
      name,
      role: typeof candidate.role === 'string' ? candidate.role.trim().slice(0, 512) : '',
      workflow,
      skills,
      memoryFiles: takeBundleFiles(
        candidate.memoryFiles,
        TEAM_IMPORT_BUNDLE_LIMITS.maxMemoryFilesPerMember,
        context
      ),
      ...(agentDefinition ? { agentDefinition } : {}),
    });
  }
  return members;
}

function parseSkills(rawSkills: unknown, context: BudgetContext): TeamImportBundleSkill[] {
  if (!Array.isArray(rawSkills)) return [];
  const skills: TeamImportBundleSkill[] = [];
  const seenSlugs = new Set<string>();
  for (const rawSkill of rawSkills) {
    if (!rawSkill || typeof rawSkill !== 'object') continue;
    const candidate = rawSkill as Record<string, unknown>;
    const slug = normalizeSlug(typeof candidate.slug === 'string' ? candidate.slug : '');
    if (skills.length >= TEAM_IMPORT_BUNDLE_LIMITS.maxSkills) {
      context.warnings.push({
        code: 'bundleSkillDropped',
        slug: slug || '…',
        reason: `more than ${TEAM_IMPORT_BUNDLE_LIMITS.maxSkills} skills`,
      });
      continue;
    }
    if (!slug || slug === 'imported-team') {
      context.warnings.push({
        code: 'bundleSkillDropped',
        slug: String(candidate.slug ?? '(unnamed)').slice(0, 64),
        reason: 'invalid skill slug',
      });
      continue;
    }
    if (seenSlugs.has(slug)) {
      context.warnings.push({ code: 'bundleSkillDropped', slug, reason: 'duplicate skill slug' });
      continue;
    }
    const description =
      typeof candidate.description === 'string' ? candidate.description.trim().slice(0, 1024) : '';
    const files = takeBundleFiles(
      candidate.files,
      TEAM_IMPORT_BUNDLE_LIMITS.maxFilesPerSkill,
      context
    );
    if (!files.some((file) => file.relativePath.toLowerCase() === 'skill.md')) {
      files.unshift({
        relativePath: 'SKILL.md',
        content: `---\nname: ${slug}\ndescription: ${description || slug}\n---\n\n# ${slug}\n\n${description}\n`,
      });
    }
    seenSlugs.add(slug);
    skills.push({ slug, description, files });
  }
  return skills;
}

export function parseTeamImportBundle(rawModelOutput: string): ParsedTeamImportBundle {
  const warnings: TeamImportWarning[] = [];
  const jsonText = extractJsonObjectText(rawModelOutput);
  if (!jsonText) {
    return {
      bundle: null,
      warnings,
      blockingErrors: ['The AI parser did not return a team definition. Try again.'],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      bundle: null,
      warnings,
      blockingErrors: ['The AI parser returned invalid JSON. Try again.'],
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      bundle: null,
      warnings,
      blockingErrors: ['The AI parser returned an unexpected result. Try again.'],
    };
  }

  const root = parsed as Record<string, unknown>;
  const teamRaw = (root.team ?? {}) as Record<string, unknown>;
  const teamName = normalizeSlug(typeof teamRaw.name === 'string' ? teamRaw.name : '');
  const context: BudgetContext = { totalBytes: 0, warnings };
  const members = parseMembers(root.members, context);
  const skills = parseSkills(root.skills, context);

  const blockingErrors: string[] = [];
  if (members.length === 0) {
    blockingErrors.push('No usable team members could be extracted from the source.');
  }

  const knownSlugs = new Set(skills.map((skill) => skill.slug));
  for (const member of members) {
    member.skills = member.skills.filter((slug) => knownSlugs.has(slug));
  }

  return {
    bundle:
      blockingErrors.length === 0
        ? {
            schema: TEAM_IMPORT_BUNDLE_SCHEMA,
            team: {
              name: teamName || 'imported-team',
              ...(typeof teamRaw.description === 'string' && teamRaw.description.trim()
                ? { description: teamRaw.description.trim().slice(0, 2048) }
                : {}),
              ...(typeof teamRaw.leadPrompt === 'string' && teamRaw.leadPrompt.trim()
                ? { leadPrompt: teamRaw.leadPrompt.trim() }
                : {}),
            },
            members,
            skills,
          }
        : null,
    warnings,
    blockingErrors,
  };
}
