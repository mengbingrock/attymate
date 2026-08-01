import * as fs from 'fs/promises';
import * as path from 'path';

import { normalizeMatterDto, normalizeMatterProposalDto } from '../../contracts';

import type { MatterSnapshotDto } from '../../contracts';

const MATTER_FILE = 'matter.json';
const MATTER_PROPOSAL_FILE = 'matter-proposal.json';

function isSafeTeamName(teamName: string): boolean {
  return (
    teamName.trim().length > 0 &&
    !teamName.includes('/') &&
    !teamName.includes('\\') &&
    teamName !== '.' &&
    teamName !== '..'
  );
}

async function readJsonOrNull(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
  } catch {
    // Missing or corrupt files are treated as absent.
    return null;
  }
}

/**
 * Read-only access to the per-team matter dashboard files. All writes go
 * through the agent-teams controller (agent proposals) or user approval
 * (TeamDataService.applyMatterProposal).
 */
export class MatterFileReader {
  constructor(private readonly teamsBasePath: string) {}

  async getSnapshot(teamName: string): Promise<MatterSnapshotDto> {
    if (!isSafeTeamName(teamName)) {
      return { matter: null, proposal: null };
    }
    const teamDir = path.join(this.teamsBasePath, teamName.trim());
    const [matterRaw, proposalRaw] = await Promise.all([
      readJsonOrNull(path.join(teamDir, MATTER_FILE)),
      readJsonOrNull(path.join(teamDir, MATTER_PROPOSAL_FILE)),
    ]);
    return {
      matter: normalizeMatterDto(matterRaw),
      proposal: normalizeMatterProposalDto(proposalRaw),
    };
  }
}
