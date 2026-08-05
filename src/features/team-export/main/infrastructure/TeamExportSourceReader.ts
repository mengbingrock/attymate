import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { isLeadMember } from '@shared/utils/leadDetection';

import type { TeamExportSourceReaderPort } from '../../core/application/ports/TeamExportPorts';
import type { TeamExportMemberSource, TeamExportSource } from '../../core/domain/teamExportPolicy';

const TEAM_META_FILE = 'team.meta.json';
const MEMBERS_META_FILE = 'members.meta.json';
const AGENTS_DIR = 'agents';
const AGENT_INSTRUCTIONS_FILE = 'AGENT.md';
const CLAUDE_AGENT_DEFINITION_FILE = 'claude-agent-definition.md';

/** Cap per agent file, matching the importer's per-agent-file ceiling. */
const MAX_AGENT_FILE_BYTES = 256 * 1024;

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function readTextFile(filePath: string): Promise<string | undefined> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_AGENT_FILE_BYTES) return undefined;
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Reads what a team is, as opposed to what it has been doing: the roster, each
 * agent's definition and instructions, and the lead prompt. Tasks, inboxes,
 * matter data, and agent memory are intentionally not read — they belong to one
 * live case, not to a reusable team.
 */
export class TeamExportSourceReader implements TeamExportSourceReaderPort {
  constructor(
    private readonly teamsBasePath: string,
    /** Lists the slugs in the team's own project skill roots. */
    private readonly listProjectSkillSlugs: (
      projectPath: string
    ) => Promise<string[]> = async () => []
  ) {}

  async read(teamName: string): Promise<TeamExportSource> {
    const teamDir = path.join(this.teamsBasePath, teamName);
    const [teamMeta, membersMeta] = await Promise.all([
      readJson(path.join(teamDir, TEAM_META_FILE)),
      readJson(path.join(teamDir, MEMBERS_META_FILE)),
    ]);

    const rawMembers = Array.isArray(membersMeta?.members)
      ? (membersMeta.members as Record<string, unknown>[])
      : [];

    const members: TeamExportMemberSource[] = [];
    for (const raw of rawMembers) {
      const name = readString(raw.name);
      // The lead is created by the app at team creation, never imported as an
      // agent definition.
      if (!name || isLeadMember({ name, agentType: raw.agentType })) continue;
      const agentDir = path.join(teamDir, AGENTS_DIR, name);
      const [agentMarkdown, agentDefinitionMarkdown] = await Promise.all([
        readTextFile(path.join(agentDir, AGENT_INSTRUCTIONS_FILE)),
        readTextFile(path.join(agentDir, CLAUDE_AGENT_DEFINITION_FILE)),
      ]);
      members.push({
        name,
        ...(readString(raw.role) ? { role: readString(raw.role)! } : {}),
        ...(readString(raw.workflow) ? { workflow: readString(raw.workflow)! } : {}),
        ...(Array.isArray(raw.skills) && raw.skills.length > 0
          ? { skills: raw.skills.filter((slug): slug is string => typeof slug === 'string') }
          : {}),
        ...(readString(raw.model) ? { model: readString(raw.model)! } : {}),
        ...(readString(raw.agentType) ? { agentType: readString(raw.agentType)! } : {}),
        ...(agentMarkdown ? { agentMarkdown } : {}),
        ...(agentDefinitionMarkdown ? { agentDefinitionMarkdown } : {}),
      });
    }

    const projectPath = readString(teamMeta?.cwd);
    const projectSkillSlugs = projectPath ? await this.listProjectSkillSlugs(projectPath) : [];

    return {
      teamName,
      ...(readString(teamMeta?.description)
        ? { description: readString(teamMeta?.description)! }
        : {}),
      ...(readString(teamMeta?.prompt) ? { leadPrompt: readString(teamMeta?.prompt)! } : {}),
      ...(projectSkillSlugs.length > 0 ? { projectSkillSlugs } : {}),
      members,
    };
  }
}
