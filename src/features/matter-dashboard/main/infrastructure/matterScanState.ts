import type { MatterDto, MatterSnapshotDto } from '../../contracts';

/** Bookkeeping keys that exist on every matter document; not case content. */
const NON_CONTENT_KEYS = new Set([
  'id',
  'schemaVersion',
  'createdAt',
  'updatedAt',
  'updatedBy',
  'approvedBy',
]);

function isMatterContentEmpty(matter: MatterDto): boolean {
  return Object.keys(matter).every((key) => NON_CONTENT_KEYS.has(key));
}

/**
 * True when the team has no matter content yet: no linked matters, or every
 * linked matter carries nothing beyond bookkeeping. Used to gate the lead's
 * initial folder-scan instruction at refresh time.
 */
export function isMatterSnapshotEffectivelyEmpty(snapshot: MatterSnapshotDto): boolean {
  const linked = snapshot.matters.filter((matter) => snapshot.linkedMatterIds.includes(matter.id));
  return linked.length === 0 || linked.every((matter) => isMatterContentEmpty(matter));
}
