const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeJsonFileSync } = require('./atomicFile.js');
const { withFileLockSync } = require('./fileLock.js');
const { assertSafePathSegment } = require('./runtimeHelpers.js');

// Keep in sync with src/features/matter-dashboard/contracts/dto.ts and
// mcp-server/src/tools/matterTools.ts (no shared import across packages).
const MATTER_SCHEMA_VERSION = 2;
const MAX_PAYLOAD_BYTES = 256 * 1024;

/**
 * v2: matters live in the app's own model-agnostic store, one folder per
 * matter, independent of any team or AI runtime:
 *
 *   <mattersDir>/<matterId>/matter.json     one matter document (no team fields)
 *   <mattersDir>/team-links.json            { [teamName]: matterIds[] }
 *   <mattersDir>/proposals/<teamName>.json  the team's pending proposal
 *
 * Team dirs are touched only to import a legacy per-team matter.json, which
 * is then replaced by a { migratedTo } stub. This module remains the ONLY
 * writer of matter state.
 */
function resolveMattersDir(context) {
  const fromContext =
    context && context.paths && typeof context.paths.mattersDir === 'string'
      ? context.paths.mattersDir.trim()
      : '';
  const fromEnv =
    typeof process.env.AGENT_TEAMS_MATTERS_DIR === 'string'
      ? process.env.AGENT_TEAMS_MATTERS_DIR.trim()
      : '';
  const mattersDir = fromContext || fromEnv;
  if (!mattersDir) {
    throw new Error('Matters store path is not configured (mattersDir)');
  }
  return mattersDir;
}

/** One lock serializes every store mutation; matters are small and writes rare. */
function storeLockPath(context) {
  return path.join(resolveMattersDir(context), '.store');
}

function matterPath(context, matterId) {
  const safeId = assertSafePathSegment('matter', matterId);
  return path.join(resolveMattersDir(context), safeId, 'matter.json');
}

function linksPath(context) {
  return path.join(resolveMattersDir(context), 'team-links.json');
}

function proposalPath(context) {
  const safeTeam = assertSafePathSegment('team', context.teamName);
  return path.join(resolveMattersDir(context), 'proposals', `${safeTeam}.json`);
}

function legacyMatterPath(context) {
  return path.join(context.paths.teamDir, 'matter.json');
}

function legacyProposalPath(context) {
  return path.join(context.paths.teamDir, 'matter-proposal.json');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJsonOrNull(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    // Corrupt files are treated as absent; the next write replaces them.
    return null;
  }
}

const MATTER_BOOKKEEPING_KEYS = new Set([
  'schemaVersion',
  'id',
  'createdAt',
  'updatedAt',
  'updatedBy',
  'approvedBy',
  'migratedTo',
]);

/** True when a matter document holds real content beyond bookkeeping. */
function hasMatterContent(value) {
  if (!isPlainObject(value)) return false;
  return Object.keys(value).some((key) => !MATTER_BOOKKEEPING_KEYS.has(key));
}

function newMatterId() {
  return `m-${crypto.randomUUID()}`;
}

function newRecordId() {
  return `rec-${crypto.randomBytes(5).toString('hex')}`;
}

/**
 * Agents and user edits routinely send records without ids. Stamp durable
 * ones at persist time so later edits and renders address records stably.
 * Walks matter-level arrays and one level of section objects.
 */
function ensureRecordIds(document) {
  const stampArray = (items) => {
    for (const item of items) {
      if (isPlainObject(item) && (typeof item.id !== 'string' || !item.id.trim())) {
        item.id = newRecordId();
      }
    }
  };
  for (const value of Object.values(document)) {
    if (Array.isArray(value)) {
      stampArray(value);
    } else if (isPlainObject(value)) {
      for (const nested of Object.values(value)) {
        if (Array.isArray(nested)) stampArray(nested);
      }
    }
  }
  return document;
}

/**
 * Merge semantics shared with the matter-dashboard contracts: scalar values
 * replace, arrays replace wholesale, object sections merge shallowly. The
 * agent-level read-modify-write is matter_get before matter_propose.
 */
function mergeChanges(current, changes) {
  const merged = { ...current };
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = { ...merged[key], ...value };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function readLinksMap(context) {
  const raw = readJsonOrNull(linksPath(context));
  if (!isPlainObject(raw)) return {};
  const links = {};
  for (const [team, ids] of Object.entries(raw)) {
    if (!Array.isArray(ids)) continue;
    const cleaned = ids.filter((id) => typeof id === 'string' && id.trim());
    if (cleaned.length > 0) links[team] = cleaned;
  }
  return links;
}

function writeLinksMap(context, links) {
  writeJsonFileSync(linksPath(context), links, { trailingNewline: true });
}

function listMatterIds(context) {
  let entries;
  try {
    entries = fs.readdirSync(resolveMattersDir(context), { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== 'proposals')
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(resolveMattersDir(context), name, 'matter.json')))
    .sort();
}

function readMatterById(context, matterId) {
  return readJsonOrNull(matterPath(context, matterId));
}

function writeMatter(context, matter) {
  writeJsonFileSync(matterPath(context, matter.id), ensureRecordIds(matter), {
    trailingNewline: true,
  });
}

/**
 * Imports the legacy per-team matter.json (and pending proposal) into the
 * store, once. The legacy file becomes a stub pointing at the new matter so
 * repeated reads never import twice. Runs under the store lock.
 */
function importLegacyTeamMatterLocked(context, links) {
  const legacy = readJsonOrNull(legacyMatterPath(context));
  if (!legacy || typeof legacy.migratedTo === 'string') return null;

  let importedId = null;
  if (hasMatterContent(legacy)) {
    importedId = newMatterId();
    const matter = { ...legacy };
    delete matter.migratedTo;
    matter.id = importedId;
    matter.schemaVersion = MATTER_SCHEMA_VERSION;
    matter.createdAt = typeof matter.createdAt === 'string' ? matter.createdAt : new Date().toISOString();
    writeMatter(context, matter);
    const linked = links[context.teamName] || [];
    links[context.teamName] = [...linked, importedId];
    writeLinksMap(context, links);
  }

  writeJsonFileSync(
    legacyMatterPath(context),
    {
      schemaVersion: MATTER_SCHEMA_VERSION,
      ...(importedId ? { migratedTo: importedId } : {}),
    },
    { trailingNewline: true }
  );

  const legacyProposal = readJsonOrNull(legacyProposalPath(context));
  if (legacyProposal) {
    if (!readJsonOrNull(proposalPath(context))) {
      writeJsonFileSync(
        proposalPath(context),
        importedId ? { ...legacyProposal, matterId: importedId } : legacyProposal,
        { trailingNewline: true }
      );
    }
    fs.rmSync(legacyProposalPath(context), { force: true });
  }
  return importedId;
}

/**
 * The dashboard read: every matter in the store, the requesting team's linked
 * ids, and its pending proposal. Imports the team's legacy matter file first,
 * so opening a pre-v2 team migrates it transparently.
 */
function getSnapshot(context) {
  return withFileLockSync(storeLockPath(context), () => {
    const links = readLinksMap(context);
    importLegacyTeamMatterLocked(context, links);
    const matters = listMatterIds(context)
      .map((matterId) => readMatterById(context, matterId))
      .filter((matter) => isPlainObject(matter));
    const linkedMatterIds = links[context.teamName] || [];
    return {
      matters,
      linkedMatterIds: linkedMatterIds.filter((id) =>
        matters.some((matter) => matter.id === id)
      ),
      proposal: readJsonOrNull(proposalPath(context)),
    };
  });
}

function readProposal(context) {
  return readJsonOrNull(proposalPath(context));
}

function assertChangesInput(changes) {
  if (!isPlainObject(changes) || Object.keys(changes).length === 0) {
    throw new Error('Matter changes must be a non-empty object of changed sections');
  }
  if (Buffer.byteLength(JSON.stringify(changes), 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new Error('Matter changes are too large (max 256 KB)');
  }
}

/** Direct user-authored edit: merges without any proposal involvement. */
function updateMatter(context, input) {
  const matterId = typeof input?.matterId === 'string' ? input.matterId.trim() : '';
  if (!matterId) throw new Error('updateMatter requires a matterId');
  assertChangesInput(input.changes);
  const actor = typeof input.actor === 'string' && input.actor.trim() ? input.actor.trim() : 'user';
  return withFileLockSync(storeLockPath(context), () => {
    const current = readMatterById(context, matterId);
    if (!current) throw new Error(`Unknown matter: ${matterId}`);
    const merged = mergeChanges(current, input.changes);
    merged.id = matterId;
    merged.schemaVersion = MATTER_SCHEMA_VERSION;
    merged.updatedAt = new Date().toISOString();
    merged.updatedBy = actor;
    writeMatter(context, merged);
    return { matter: merged };
  });
}

/** Creates a matter; links it to the calling team unless { link: false }. */
function createMatter(context, init) {
  const caption = typeof init?.caption === 'string' && init.caption.trim() ? init.caption.trim() : undefined;
  const link = init?.link !== false;
  return withFileLockSync(storeLockPath(context), () => {
    const matter = {
      id: newMatterId(),
      schemaVersion: MATTER_SCHEMA_VERSION,
      ...(caption ? { caption } : {}),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: 'user',
    };
    writeMatter(context, matter);
    if (link) {
      const links = readLinksMap(context);
      links[context.teamName] = [...(links[context.teamName] || []), matter.id];
      writeLinksMap(context, links);
    }
    return { matter };
  });
}

function linkTeam(context, matterId) {
  const id = typeof matterId === 'string' ? matterId.trim() : '';
  if (!id) throw new Error('linkTeam requires a matterId');
  return withFileLockSync(storeLockPath(context), () => {
    if (!readMatterById(context, id)) throw new Error(`Unknown matter: ${id}`);
    const links = readLinksMap(context);
    const linked = links[context.teamName] || [];
    if (!linked.includes(id)) {
      links[context.teamName] = [...linked, id];
      writeLinksMap(context, links);
    }
    return { linkedMatterIds: links[context.teamName] };
  });
}

function unlinkTeam(context, matterId) {
  const id = typeof matterId === 'string' ? matterId.trim() : '';
  if (!id) throw new Error('unlinkTeam requires a matterId');
  return withFileLockSync(storeLockPath(context), () => {
    const links = readLinksMap(context);
    const remaining = (links[context.teamName] || []).filter((linked) => linked !== id);
    if (remaining.length > 0) {
      links[context.teamName] = remaining;
    } else {
      delete links[context.teamName];
    }
    writeLinksMap(context, links);
    return { linkedMatterIds: remaining };
  });
}

function assertProposalInput(proposal) {
  if (!isPlainObject(proposal)) {
    throw new Error('Matter proposal must be an object');
  }
  const summary = proposal.summary;
  if (
    !Array.isArray(summary) ||
    summary.length === 0 ||
    !summary.every((item) => typeof item === 'string' && item.trim())
  ) {
    throw new Error('Matter proposal summary must be a non-empty array of strings');
  }
  if (!isPlainObject(proposal.changes) || Object.keys(proposal.changes).length === 0) {
    throw new Error('Matter proposal changes must be a non-empty object of changed sections');
  }
  if (proposal.matterId !== undefined && (typeof proposal.matterId !== 'string' || !proposal.matterId.trim())) {
    throw new Error('Matter proposal matterId must be a non-empty string');
  }
  if (proposal.taskRefs !== undefined && !Array.isArray(proposal.taskRefs)) {
    throw new Error('Matter proposal taskRefs must be an array of task ids');
  }
  if (
    proposal.sourceMode !== undefined &&
    proposal.sourceMode !== 'direct-scan' &&
    proposal.sourceMode !== 'link'
  ) {
    throw new Error('Matter proposal sourceMode must be direct-scan or link');
  }
  if (
    proposal.sourceRevision !== undefined &&
    (typeof proposal.sourceRevision !== 'string' || !proposal.sourceRevision.trim())
  ) {
    throw new Error('Matter proposal sourceRevision must be a non-empty string');
  }
  if (proposal.evidence !== undefined) {
    if (
      !Array.isArray(proposal.evidence) ||
      proposal.evidence.length > 50 ||
      !proposal.evidence.every(
        (item) => isPlainObject(item) && typeof item.path === 'string' && item.path.trim()
      )
    ) {
      throw new Error('Matter proposal evidence must contain at most 50 source references');
    }
  }
  if (Buffer.byteLength(JSON.stringify(proposal), 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new Error('Matter proposal is too large (max 256 KB)');
  }
}

/**
 * Resolves which matter a proposal addresses. An explicit matterId wins; a
 * team linked to exactly one matter defaults to it; a team with no matter
 * yet returns null (apply creates one); several links demand an explicit id.
 */
function resolveProposalTarget(context, links, requestedId) {
  const linked = links[context.teamName] || [];
  if (requestedId) {
    if (!readMatterById(context, requestedId)) {
      throw new Error(`Unknown matter: ${requestedId}`);
    }
    return requestedId;
  }
  if (linked.length === 0) return null;
  if (linked.length === 1) return linked[0];
  throw new Error(
    `matterId is required: team "${context.teamName}" is linked to ${linked.length} matters`
  );
}

/**
 * Records a pending dashboard-update proposal for user review. Overwrites any
 * existing pending proposal (last write wins). Nothing is applied to the
 * matter until the user approves in the dashboard.
 */
function submitProposal(context, proposal, actor) {
  assertProposalInput(proposal);
  const actorName = typeof actor === 'string' && actor.trim() ? actor.trim() : 'team-lead';
  return withFileLockSync(storeLockPath(context), () => {
    const links = readLinksMap(context);
    // Import mutates `links` in place when it links a migrated matter.
    importLegacyTeamMatterLocked(context, links);
    const requestedId =
      typeof proposal.matterId === 'string' && proposal.matterId.trim()
        ? proposal.matterId.trim()
        : undefined;
    const targetId = resolveProposalTarget(context, links, requestedId);
    const record = {
      schemaVersion: MATTER_SCHEMA_VERSION,
      ...(targetId ? { matterId: targetId } : {}),
      proposedAt: new Date().toISOString(),
      proposedBy: actorName,
      summary: proposal.summary.map((item) => item.trim()),
      changes: proposal.changes,
      ...(Array.isArray(proposal.taskRefs) && proposal.taskRefs.length > 0
        ? { taskRefs: proposal.taskRefs.map((taskId) => String(taskId)) }
        : {}),
      ...(proposal.sourceMode ? { sourceMode: proposal.sourceMode } : {}),
      ...(typeof proposal.sourceRevision === 'string' && proposal.sourceRevision.trim()
        ? { sourceRevision: proposal.sourceRevision.trim() }
        : {}),
      ...(Array.isArray(proposal.evidence) && proposal.evidence.length > 0
        ? { evidence: proposal.evidence }
        : {}),
    };
    writeJsonFileSync(proposalPath(context), record, { trailingNewline: true });
    return record;
  });
}

/** Applies the pending proposal to its matter and clears it. User-approval only. */
function applyProposal(context, approvedBy) {
  return withFileLockSync(storeLockPath(context), () => {
    const proposal = readJsonOrNull(proposalPath(context));
    if (!proposal) {
      throw new Error('No pending matter proposal to apply');
    }
    const links = readLinksMap(context);
    let targetId =
      typeof proposal.matterId === 'string' && proposal.matterId.trim()
        ? proposal.matterId.trim()
        : resolveProposalTarget(context, links, undefined);
    let current = targetId ? readMatterById(context, targetId) : null;
    if (!current) {
      // First proposal of a matterless team establishes the matter itself.
      if (!targetId) targetId = newMatterId();
      current = { id: targetId, createdAt: new Date().toISOString() };
      const linked = links[context.teamName] || [];
      if (!linked.includes(targetId)) {
        links[context.teamName] = [...linked, targetId];
        writeLinksMap(context, links);
      }
    }
    const merged = mergeChanges(current, isPlainObject(proposal.changes) ? proposal.changes : {});
    merged.id = targetId;
    merged.schemaVersion = MATTER_SCHEMA_VERSION;
    merged.updatedAt = new Date().toISOString();
    merged.updatedBy =
      typeof proposal.proposedBy === 'string' && proposal.proposedBy.trim()
        ? proposal.proposedBy.trim()
        : 'team-lead';
    merged.approvedBy =
      typeof approvedBy === 'string' && approvedBy.trim() ? approvedBy.trim() : 'user';
    writeMatter(context, merged);
    fs.rmSync(proposalPath(context), { force: true });
    return { matter: merged, proposal };
  });
}

/** Clears the pending proposal without applying it. Returns the rejected proposal. */
function rejectProposal(context) {
  return withFileLockSync(storeLockPath(context), () => {
    const proposal = readJsonOrNull(proposalPath(context));
    if (!proposal) {
      throw new Error('No pending matter proposal to reject');
    }
    fs.rmSync(proposalPath(context), { force: true });
    return proposal;
  });
}

// Only functions here: controller.js bindModule() wraps every export in a
// context-bound function, so plain constants must not be exported.
module.exports = {
  getSnapshot,
  readProposal,
  updateMatter,
  createMatter,
  linkTeam,
  unlinkTeam,
  submitProposal,
  applyProposal,
  rejectProposal,
};
