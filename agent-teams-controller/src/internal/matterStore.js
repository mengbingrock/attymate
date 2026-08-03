const fs = require('fs');
const path = require('path');
const { writeJsonFileSync } = require('./atomicFile.js');
const { withFileLockSync } = require('./fileLock.js');

const MATTER_SCHEMA_VERSION = 1;
const MATTER_FILE = 'matter.json';
const MATTER_PROPOSAL_FILE = 'matter-proposal.json';
const MAX_PAYLOAD_BYTES = 256 * 1024;

function matterPath(context) {
  return path.join(context.paths.teamDir, MATTER_FILE);
}

function proposalPath(context) {
  return path.join(context.paths.teamDir, MATTER_PROPOSAL_FILE);
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

function readMatter(context) {
  return readJsonOrNull(matterPath(context));
}

function readProposal(context) {
  return readJsonOrNull(proposalPath(context));
}

/**
 * Records a pending dashboard-update proposal for user review. Overwrites any
 * existing pending proposal (last write wins). Nothing is applied to the
 * matter until the user approves in the dashboard.
 */
function submitProposal(context, proposal, actor) {
  assertProposalInput(proposal);
  const actorName = typeof actor === 'string' && actor.trim() ? actor.trim() : 'team-lead';
  return withFileLockSync(matterPath(context), () => {
    const record = {
      schemaVersion: MATTER_SCHEMA_VERSION,
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

/** Applies the pending proposal to the matter and clears it. User-approval only. */
function applyProposal(context, approvedBy) {
  return withFileLockSync(matterPath(context), () => {
    const proposal = readJsonOrNull(proposalPath(context));
    if (!proposal) {
      throw new Error('No pending matter proposal to apply');
    }
    const current = readJsonOrNull(matterPath(context)) || {};
    const merged = mergeChanges(current, isPlainObject(proposal.changes) ? proposal.changes : {});
    merged.schemaVersion = MATTER_SCHEMA_VERSION;
    merged.updatedAt = new Date().toISOString();
    merged.updatedBy =
      typeof proposal.proposedBy === 'string' && proposal.proposedBy.trim()
        ? proposal.proposedBy.trim()
        : 'team-lead';
    merged.approvedBy =
      typeof approvedBy === 'string' && approvedBy.trim() ? approvedBy.trim() : 'user';
    writeJsonFileSync(matterPath(context), merged, { trailingNewline: true });
    fs.rmSync(proposalPath(context), { force: true });
    return { matter: merged, proposal };
  });
}

/** Clears the pending proposal without applying it. Returns the rejected proposal. */
function rejectProposal(context) {
  return withFileLockSync(matterPath(context), () => {
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
  readMatter,
  readProposal,
  submitProposal,
  applyProposal,
  rejectProposal,
};
