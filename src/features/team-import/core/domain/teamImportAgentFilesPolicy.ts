import { LEAD_PREFIX, MEMBER_PREFIX, suggestTeamImportName } from './teamImportPolicy';

import type {
  TeamImportBundle,
  TeamImportBundleFile,
  TeamImportBundleMember,
  TeamImportPreview,
} from '@features/team-import/contracts';

export const AGENT_INSTRUCTIONS_FILE = 'AGENT.md';
export const AGENT_MEMORY_FILE = 'memory/MEMORY.md';
export const CLAUDE_AGENT_DEFINITION_FILE = 'claude-agent-definition.md';

function yamlScalar(value: string): string {
  return /^\w[\w .,\-()/]*$/.test(value) ? value : JSON.stringify(value);
}

function yamlList(values: readonly string[]): string {
  return `[${values.map((value) => yamlScalar(value)).join(', ')}]`;
}

/**
 * Render a member as a standard Claude Code subagent definition
 * (markdown + YAML frontmatter, per https://code.claude.com/docs/en/sub-agents),
 * ready to be dropped into `.claude/agents/` or `~/.claude/agents/`. Captured
 * `agentDefinition` frontmatter (tools, model, permissionMode, …) is included
 * verbatim when the source grounded it.
 */
/**
 * A member's skills, from whichever source the bundle grounded. Both the agent
 * instructions and the Claude definition must read this same list — when they
 * disagreed, an agent could be told "(none assigned)" while its own definition
 * listed skills.
 */
export function resolveMemberSkills(member: TeamImportBundleMember): string[] {
  const definitionSkills = member.agentDefinition?.skills;
  return definitionSkills?.length ? definitionSkills : member.skills;
}

export function buildClaudeAgentDefinitionMarkdown(member: TeamImportBundleMember): string {
  const definition = member.agentDefinition;
  const frontmatter: string[] = [
    '---',
    `name: ${yamlScalar(member.name)}`,
    `description: ${yamlScalar(member.role || 'Imported team member.')}`,
  ];
  if (definition?.tools?.length) frontmatter.push(`tools: ${definition.tools.join(', ')}`);
  if (definition?.disallowedTools?.length) {
    frontmatter.push(`disallowedTools: ${definition.disallowedTools.join(', ')}`);
  }
  if (definition?.model) frontmatter.push(`model: ${yamlScalar(definition.model)}`);
  if (definition?.permissionMode) {
    frontmatter.push(`permissionMode: ${yamlScalar(definition.permissionMode)}`);
  }
  if (definition?.maxTurns) frontmatter.push(`maxTurns: ${definition.maxTurns}`);
  const skills = resolveMemberSkills(member);
  if (skills.length > 0) frontmatter.push(`skills: ${yamlList(skills)}`);
  if (definition?.mcpServers?.length) {
    frontmatter.push(`mcpServers: ${yamlList(definition.mcpServers)}`);
  }
  if (definition?.memory) frontmatter.push(`memory: ${definition.memory}`);
  frontmatter.push('---');

  const hooksNote = definition?.hooks
    ? [
        '',
        '<!-- Hooks described by the source (translate to Claude Code hook config as needed):',
        JSON.stringify(definition.hooks, null, 2),
        '-->',
      ]
    : [];

  return [...frontmatter, '', member.workflow.trim(), ...hooksNote, ''].join('\n');
}

/**
 * Files materialized under the app-owned per-agent directory
 * (~/.claude/teams/<team>/agents/<member>/) at draft-apply time.
 */
export function buildAgentFiles(
  member: TeamImportBundleMember,
  skillDescriptions: ReadonlyMap<string, string>
): TeamImportBundleFile[] {
  const memberSkills = resolveMemberSkills(member);
  const skillLines =
    memberSkills.length > 0
      ? memberSkills.map((slug) => {
          const description = skillDescriptions.get(slug);
          return description ? `- ${slug} — ${description}` : `- ${slug}`;
        })
      : ['- (none assigned — use project skills when the workflow requires them)'];

  const agentMd = [
    `# ${member.name}`,
    '',
    `## Role`,
    '',
    member.role || 'Team member.',
    '',
    '## Your skills',
    '',
    'Use these skills when the work calls for them (Claude: load via the Skill tool; Codex: invoke via your skills mechanism):',
    ...skillLines,
    '',
    '## Memory protocol',
    '',
    `Your durable memory lives in \`${AGENT_MEMORY_FILE}\` next to this file. Read it before starting work. After completing significant work, append concise learnings (decisions, pitfalls, project facts) so future sessions benefit. Keep entries short and factual.`,
    '',
    '## Workflow',
    '',
    member.workflow.trim(),
    '',
  ].join('\n');

  const files: TeamImportBundleFile[] = [
    { relativePath: AGENT_INSTRUCTIONS_FILE, content: agentMd },
    // Claude-standard subagent definition so the imported role is reusable
    // outside this app (copy into .claude/agents/ or ~/.claude/agents/).
    {
      relativePath: CLAUDE_AGENT_DEFINITION_FILE,
      content: buildClaudeAgentDefinitionMarkdown(member),
    },
  ];

  const hasMemoryIndex = member.memoryFiles.some(
    (file) => file.relativePath.toLowerCase() === AGENT_MEMORY_FILE.toLowerCase()
  );
  if (!hasMemoryIndex) {
    files.push({
      relativePath: AGENT_MEMORY_FILE,
      content: `# Memory — ${member.name}\n\nAppend durable learnings below. One short entry per fact.\n`,
    });
  }
  for (const memoryFile of member.memoryFiles) {
    const relativePath = memoryFile.relativePath.startsWith('memory/')
      ? memoryFile.relativePath
      : `memory/${memoryFile.relativePath}`;
    if (relativePath.toLowerCase() === AGENT_INSTRUCTIONS_FILE.toLowerCase()) continue;
    files.push({ relativePath, content: memoryFile.content });
  }
  return files;
}

/**
 * Replacement workflow persisted to members.meta.json: a short pointer the lead
 * copies into the teammate spawn prompt instead of the full instruction body.
 */
export function buildWorkflowPointer(agentDirAbsolutePath: string, memberName: string): string {
  return [
    MEMBER_PREFIX,
    `- You are ${memberName}. FIRST ACTION every session: read \`${agentDirAbsolutePath}/${AGENT_INSTRUCTIONS_FILE}\` and follow it — it defines your role, skills, and workflow.`,
    `- Your durable memory is \`${agentDirAbsolutePath}/${AGENT_MEMORY_FILE}\`: read it at start, append important learnings when you finish significant work.`,
  ].join('\n');
}

export function bundleToPreview(
  bundle: TeamImportBundle,
  input: { projectPath: string; sourceLabel: string; existingSkillSlugs: ReadonlySet<string> }
): Omit<TeamImportPreview, 'reviewId'> {
  return {
    importKind: 'smart',
    suggestedTeamName: suggestTeamImportName(bundle.team.name),
    projectPath: input.projectPath,
    sourceLabel: input.sourceLabel,
    teamDescription: bundle.team.description,
    members: bundle.members.map((member) => ({
      name: member.name,
      role: member.role || 'member',
      workflow: member.workflow,
      // Carry the source's model choice onto the new roster when the bundle
      // grounded one; otherwise the team falls back to the app default.
      ...(member.agentDefinition?.model ? { model: member.agentDefinition.model } : {}),
      // Persisted on the roster so the assignment outlives the import.
      ...(resolveMemberSkills(member).length > 0 ? { skills: resolveMemberSkills(member) } : {}),
    })),
    memberDetails: bundle.members.map((member) => ({
      name: member.name,
      role: member.role,
      skills: resolveMemberSkills(member),
      memoryFileCount: member.memoryFiles.length,
    })),
    prompt: bundle.team.leadPrompt
      ? `${LEAD_PREFIX}\n\n## Imported orchestration workflow\n\n${bundle.team.leadPrompt}`
      : undefined,
    skillsFound: bundle.skills.map((skill) => skill.slug),
    skillPlans: bundle.skills.map((skill) => ({
      slug: skill.slug,
      description: skill.description,
      fileCount: skill.files.length,
      alreadyExists: input.existingSkillSlugs.has(skill.slug),
    })),
    warnings: [],
    blockingErrors: [],
  };
}
