import { atomicWriteAsync } from '@main/utils/atomicWrite';
import { getTeamsBasePath } from '@main/utils/pathDecoder';
import { resolveTeamLeadIdentity } from '@shared/utils/leadDetection';
import { createLogger } from '@shared/utils/logger';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const logger = createLogger('Service:TeamProvisioning');

/**
 * Bridge to stock Claude Code's own agent-team state.
 *
 * Stock agent teams live under a SESSION-DERIVED name — `session-` + the first
 * 8 characters of the lead session id — with per-agent mailbox files at
 * `~/.claude/teams/session-XXXXXXXX/inboxes/{agent}.json`. Claude Code
 * validates and consumes mailbox entries itself, so an external process can
 * deliver a message to a specific teammate directly (no lead relay) by
 * appending a well-formed entry. Verified live: an externally appended entry
 * was delivered to an in-process teammate, which acted on it.
 *
 * Headless (`--print`) leads currently do NOT materialize these directories,
 * so callers must treat this bridge as opportunistic: check
 * `isStockSessionTeamActive` and fall back to the lead relay when inactive.
 */

const SESSION_TEAM_PREFIX = 'session-';
const SESSION_ID_PREFIX_LENGTH = 8;

export function getStockSessionTeamName(leadSessionId: string | null | undefined): string | null {
  const normalized = leadSessionId?.trim().toLowerCase() ?? '';
  if (normalized.length < SESSION_ID_PREFIX_LENGTH) {
    return null;
  }
  const prefix = normalized.slice(0, SESSION_ID_PREFIX_LENGTH);
  if (!/^[0-9a-f]{8}$/.test(prefix)) {
    return null;
  }
  return `${SESSION_TEAM_PREFIX}${prefix}`;
}

export function getStockSessionTeamDir(leadSessionId: string | null | undefined): string | null {
  const teamName = getStockSessionTeamName(leadSessionId);
  return teamName ? path.join(getTeamsBasePath(), teamName) : null;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** True when the stock runtime materialized its session team on disk. */
export async function isStockSessionTeamActive(
  leadSessionId: string | null | undefined
): Promise<boolean> {
  const teamDir = getStockSessionTeamDir(leadSessionId);
  if (!teamDir) return false;
  return pathExists(path.join(teamDir, 'config.json'));
}

async function isRegisteredSessionTeamMember(
  teamDir: string,
  memberName: string
): Promise<boolean> {
  try {
    const raw = await fs.promises.readFile(path.join(teamDir, 'config.json'), 'utf-8');
    const config = JSON.parse(raw) as { members?: { name?: string }[] };
    return (config.members ?? []).some(
      (member) => typeof member.name === 'string' && member.name === memberName
    );
  } catch {
    return false;
  }
}

export interface StockSessionTeamDmInput {
  memberName: string;
  /**
   * The target is the team lead. The stock runtime registers its lead under
   * its own identity (canonically "team-lead"), NOT the app-side lead name —
   * an imported team's custom lead name (e.g. "legal-ops-supervisor") has no
   * mailbox in the session team, so lead DMs must resolve the session team's
   * actual lead and deliver there.
   */
  deliverToLead?: boolean;
  text: string;
  summary?: string;
  from?: string;
}

/** The session team's own name for its lead, from its config identity fields. */
async function resolveSessionTeamLeadName(teamDir: string): Promise<string | null> {
  try {
    const raw = await fs.promises.readFile(path.join(teamDir, 'config.json'), 'utf-8');
    const config = JSON.parse(raw) as Parameters<typeof resolveTeamLeadIdentity>[0];
    const name = resolveTeamLeadIdentity(config).name.trim();
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/**
 * Append a message to a teammate's stock mailbox file. Entry shape captured
 * from a live stock team (v2.1.217): {from, text, summary?, timestamp, msgV,
 * msg_id, type:"message", read:false}. Malformed entries are silently removed
 * by the runtime, so keep this writer in sync with the observed schema.
 *
 * Returns true when the entry was written (delivery is then owned by the
 * stock runtime); false when the session team or member is not available.
 */
export async function deliverStockSessionTeamDm(
  leadSessionId: string | null | undefined,
  input: StockSessionTeamDmInput
): Promise<boolean> {
  const teamDir = getStockSessionTeamDir(leadSessionId);
  if (!teamDir || !(await pathExists(path.join(teamDir, 'config.json')))) {
    return false;
  }
  let targetName = input.memberName;
  if (input.deliverToLead && !(await isRegisteredSessionTeamMember(teamDir, targetName))) {
    // Custom app-side lead names are unknown to the stock session team; fall
    // back to the session team's own lead identity.
    const sessionLeadName = await resolveSessionTeamLeadName(teamDir);
    if (sessionLeadName) {
      targetName = sessionLeadName;
    }
  }
  if (!(await isRegisteredSessionTeamMember(teamDir, targetName))) {
    return false;
  }

  const inboxPath = path.join(teamDir, 'inboxes', `${targetName}.json`);
  let existing: unknown[] = [];
  try {
    const raw = await fs.promises.readFile(inboxPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      existing = parsed;
    }
  } catch {
    // Missing or unreadable inbox: start a fresh mailbox array.
  }

  existing.push({
    from: input.from?.trim() || 'user',
    text: input.text,
    ...(input.summary?.trim() ? { summary: input.summary.trim() } : {}),
    timestamp: new Date().toISOString(),
    msgV: 1,
    msg_id: randomUUID(),
    type: 'message',
    read: false,
  });

  await fs.promises.mkdir(path.dirname(inboxPath), { recursive: true });
  await atomicWriteAsync(inboxPath, JSON.stringify(existing, null, 2));
  logger.info(
    `[stock-session-team] Delivered DM to "${targetName}" via ${path.basename(teamDir)} mailbox`
  );
  return true;
}
