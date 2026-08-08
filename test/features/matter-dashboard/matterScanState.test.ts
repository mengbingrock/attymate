import { isMatterSnapshotEffectivelyEmpty } from '@features/matter-dashboard/main';
import { describe, expect, it } from 'vitest';

import type { MatterDto, MatterSnapshotDto } from '@features/matter-dashboard/contracts';

function snapshot(matters: MatterDto[], linkedMatterIds: string[]): MatterSnapshotDto {
  return { matters, linkedMatterIds, proposal: null };
}

function matter(id: string, extra: Partial<MatterDto> = {}): MatterDto {
  return { id, schemaVersion: 2, ...extra };
}

describe('isMatterSnapshotEffectivelyEmpty', () => {
  it('treats no matters at all as empty', () => {
    expect(isMatterSnapshotEffectivelyEmpty(snapshot([], []))).toBe(true);
  });

  it('treats unlinked matters as empty for this team', () => {
    expect(
      isMatterSnapshotEffectivelyEmpty(
        snapshot([matter('m-1', { caption: 'Someone else v. Case' })], [])
      )
    ).toBe(true);
  });

  it('treats audit-only bookkeeping as empty', () => {
    expect(
      isMatterSnapshotEffectivelyEmpty(
        snapshot(
          [
            matter('m-1', {
              createdAt: '2026-08-01T00:00:00.000Z',
              updatedAt: '2026-08-01T00:00:00.000Z',
              updatedBy: 'team-lead',
              approvedBy: 'user',
            }),
          ],
          ['m-1']
        )
      )
    ).toBe(true);
  });

  it('treats a linked matter with real content as not empty', () => {
    expect(
      isMatterSnapshotEffectivelyEmpty(
        snapshot([matter('m-1', { caption: 'Smith v. Jones Trucking' })], ['m-1'])
      )
    ).toBe(false);
  });

  it('needs only one linked matter with content', () => {
    expect(
      isMatterSnapshotEffectivelyEmpty(
        snapshot([matter('m-1'), matter('m-2', { status: 'Active' })], ['m-1', 'm-2'])
      )
    ).toBe(false);
  });
});
