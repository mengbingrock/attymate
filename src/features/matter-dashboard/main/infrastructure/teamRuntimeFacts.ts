import { isLeadMember } from '@shared/utils/leadDetection';
import * as fs from 'fs/promises';
import * as path from 'path';

const CONFIG_FILE = 'config.json';
const TEAM_META_FILE = 'team.meta.json';
const INTERACTIVE_RUNTIME_FILE = 'interactive-runtime.json';

/**
 * Codex teammates are launched by the app as their own console lanes; a codex
 * lead that "spawns" a teammate would create a phantom roster entry.
 */
const NON_SPAWNING_RUNTIMES = new Set(['codex-lanes']);
const NON_SPAWNING_PROVIDERS = new Set(['codex']);

interface ConfigMember {
  name?: unknown;
  agentType?: unknown;
  provider?: unknown;
  providerId?: unknown;
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readMembers(config: unknown): ConfigMember[] {
  if (!config || typeof config !== 'object') return [];
  const members = (config as { members?: unknown }).members;
  return Array.isArray(members) ? (members as ConfigMember[]) : [];
}

function readField(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' && field.trim() ? field.trim() : null;
}

/**
 * Roster and runtime facts the matter skill prompt needs but the skill itself
 * must not encode, read straight from the team's persisted state.
 *
 * Spawning is decided from the provider as well as the live runtime binding:
 * the binding file only exists while a team is running, but the answer must be
 * right for a stopped team too — a Codex team routes to app-launched lanes
 * whether or not it happens to be up right now.
 */
export async function readTeamRuntimeFacts(
  teamsBasePath: string,
  teamName: string
): Promise<{ hasTeammates: boolean; canSpawnTeammates: boolean }> {
  const teamDir = path.join(teamsBasePath, teamName);
  const [config, teamMeta, binding] = await Promise.all([
    readJson(path.join(teamDir, CONFIG_FILE)),
    readJson(path.join(teamDir, TEAM_META_FILE)),
    readJson(path.join(teamDir, INTERACTIVE_RUNTIME_FILE)),
  ]);

  const members = readMembers(config);
  const hasTeammates = members.some(
    (member) => !isLeadMember(member) && typeof member.name === 'string' && member.name.trim()
  );

  const runtime = readField(binding, 'runtime');
  const lead = members.find((member) => isLeadMember(member));
  const provider =
    readField(lead, 'provider') ??
    readField(lead, 'providerId') ??
    readField(teamMeta, 'providerId');

  const nonSpawning =
    (runtime !== null && NON_SPAWNING_RUNTIMES.has(runtime)) ||
    (provider !== null && NON_SPAWNING_PROVIDERS.has(provider));

  return { hasTeammates, canSpawnTeammates: !nonSpawning };
}
