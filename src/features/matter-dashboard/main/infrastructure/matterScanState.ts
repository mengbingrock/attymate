import * as fs from 'fs/promises';
import * as path from 'path';

import { normalizeMatterDto } from '../../contracts';

const MATTER_FILE = 'matter.json';

/** Bookkeeping keys that exist on every matter file; not case content. */
const NON_CONTENT_KEYS = new Set(['schemaVersion', 'updatedAt', 'updatedBy', 'approvedBy']);

/**
 * True when the team has no matter content yet: the matter file is missing,
 * unreadable, or carries nothing beyond schema/audit bookkeeping. Used to gate
 * the lead's initial folder-scan instruction at launch.
 */
export async function isMatterEffectivelyEmpty(
  teamsBasePath: string,
  teamName: string
): Promise<boolean> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(path.join(teamsBasePath, teamName, MATTER_FILE), 'utf8'));
  } catch {
    return true;
  }
  const matter = normalizeMatterDto(raw);
  if (!matter) return true;
  return Object.keys(matter).every((key) => NON_CONTENT_KEYS.has(key));
}
