import { normalizeMatterDto, normalizeMatterProposalDto } from '../../contracts';

import type { MatterDto, MatterSnapshotDto } from '../../contracts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Normalizes the controller's raw store snapshot into the renderer contract.
 * The controller returns raw JSON documents; every boundary crossing runs
 * through the tolerant contract normalizers.
 */
export function normalizeMatterSnapshot(raw: unknown): MatterSnapshotDto {
  const record = isRecord(raw) ? raw : {};
  const matters = (Array.isArray(record.matters) ? record.matters : [])
    .map((matter) => normalizeMatterDto(matter))
    .filter((matter): matter is MatterDto => matter !== null);
  const linkedMatterIds = (
    Array.isArray(record.linkedMatterIds) ? record.linkedMatterIds : []
  ).filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  return {
    matters,
    linkedMatterIds: linkedMatterIds.filter((id) => matters.some((matter) => matter.id === id)),
    proposal: normalizeMatterProposalDto(record.proposal),
  };
}
