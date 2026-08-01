import * as fs from 'fs/promises';
import * as path from 'path';

import { MATTER_SCHEMA_VERSION } from '../../contracts';

const MATTER_FILE = 'matter.json';

/**
 * Seed a newly created team with an empty matter file. The file is a minimal
 * schema marker: its presence switches the dashboard from the demo fixture to
 * empty values, and the first approved proposal merges real sections into it.
 * No-op when the file already exists (restores, imports, re-creates).
 */
export async function initializeMatterFileIfMissing(
  teamsBasePath: string,
  teamName: string
): Promise<void> {
  const filePath = path.join(teamsBasePath, teamName, MATTER_FILE);
  try {
    await fs.writeFile(filePath, `${JSON.stringify({ schemaVersion: MATTER_SCHEMA_VERSION })}\n`, {
      // wx: fail if the file exists so we never clobber real matter data.
      flag: 'wx',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
    throw error;
  }
}
