import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { atomicWriteAsync } from '@main/utils/atomicWrite';
import { getTeamsBasePath } from '@main/utils/pathDecoder';
import { isPathWithinRoot } from '@main/utils/pathValidation';
import { validateTeamMemberNameFormat } from '@shared/utils/teamMemberName';

import { sanitizeBundleRelativePath } from '../../core/domain/teamImportBundlePolicy';

import type { TeamImportAgentFilesWriterPort } from '../../core/application/ports/TeamImportAgentFilesWriterPort';
import type { TeamImportBundleFile } from '@features/team-import/contracts';

export const TEAM_AGENTS_SUBDIR = 'agents';

export class TeamAgentFilesWriter implements TeamImportAgentFilesWriterPort {
  resolveAgentDir(teamName: string, memberName: string): string {
    if (validateTeamMemberNameFormat(memberName)) {
      throw new Error(`Invalid member name: ${memberName}`);
    }
    return path.join(getTeamsBasePath(), teamName, TEAM_AGENTS_SUBDIR, memberName);
  }

  async writeAgentFiles(
    teamName: string,
    memberName: string,
    files: readonly TeamImportBundleFile[]
  ): Promise<void> {
    const agentDir = this.resolveAgentDir(teamName, memberName);
    await fs.mkdir(agentDir, { recursive: true });
    for (const file of files) {
      const relativePath = sanitizeBundleRelativePath(file.relativePath);
      if (!relativePath) continue;
      const targetPath = path.join(agentDir, ...relativePath.split('/'));
      if (!isPathWithinRoot(targetPath, agentDir)) continue;
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await atomicWriteAsync(targetPath, file.content);
    }
  }
}
