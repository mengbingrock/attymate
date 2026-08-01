import {
  normalizeMatterChanges,
  normalizeMatterDto,
  normalizeMatterProposalDto,
} from '@features/matter-dashboard/contracts';
import { describe, expect, it } from 'vitest';

describe('normalizeMatterDto', () => {
  it('returns null for non-object input', () => {
    expect(normalizeMatterDto(null)).toBeNull();
    expect(normalizeMatterDto(undefined)).toBeNull();
    expect(normalizeMatterDto('garbage')).toBeNull();
    expect(normalizeMatterDto(42)).toBeNull();
    expect(normalizeMatterDto([1, 2])).toBeNull();
  });

  it('normalizes a full document, dropping unknown keys and bad entries', () => {
    const dto = normalizeMatterDto({
      schemaVersion: 99,
      updatedAt: '2026-08-01T10:00:00.000Z',
      updatedBy: 'team-lead',
      approvedBy: 'user',
      caption: '  Smith v. Jones  ',
      status: 'Active',
      matterNumber: 'SM-1',
      currentStage: 'trial',
      unknownSection: { anything: true },
      coreFields: [{ label: 'Client', value: 'A. Smith' }, { label: '' }, 'garbage'],
      nextDeadline: { date: 'Sep 1, 2026', label: 'Trial brief' },
      discovery: {
        requests: [{ type: 'RFP', status: 'Served' }, { set: 'missing type' }],
        pendingMotion: { motionType: 'MTC', outcome: 'Pending' },
      },
      trial: { trialDate: 'Feb 8, 2027', exhibits: [{ number: '101', title: 'MSA' }] },
    });

    expect(dto).not.toBeNull();
    expect(dto?.schemaVersion).toBe(1);
    expect(dto?.caption).toBe('Smith v. Jones');
    expect(dto?.currentStage).toBe('trial');
    expect(dto?.updatedBy).toBe('team-lead');
    expect(dto?.approvedBy).toBe('user');
    expect(dto?.coreFields).toEqual([{ label: 'Client', value: 'A. Smith' }]);
    expect(dto?.nextDeadline).toEqual({ date: 'Sep 1, 2026', label: 'Trial brief' });
    expect(dto?.discovery?.requests).toEqual([{ type: 'RFP', status: 'Served' }]);
    expect(dto?.discovery?.pendingMotion).toEqual({ motionType: 'MTC', outcome: 'Pending' });
    expect(dto?.trial?.exhibits).toEqual([{ number: '101', title: 'MSA' }]);
    expect((dto as unknown as Record<string, unknown>).unknownSection).toBeUndefined();
  });

  it('drops invalid stage ids and incomplete deadlines instead of throwing', () => {
    const dto = normalizeMatterDto({
      currentStage: 'appeal',
      nextDeadline: { date: 'Sep 1, 2026' },
      stages: [{ id: 'discovery', summary: 'wrapping up' }, { id: 'bogus' }],
    });
    expect(dto?.currentStage).toBeUndefined();
    expect(dto?.nextDeadline).toBeUndefined();
    expect(dto?.stages).toEqual([{ id: 'discovery', summary: 'wrapping up' }]);
  });
});

describe('normalizeMatterChanges', () => {
  it('preserves present-but-empty arrays (wholesale replacement semantics)', () => {
    const changes = normalizeMatterChanges({ coreFields: [], discovery: { productions: [] } });
    expect(changes.coreFields).toEqual([]);
    expect(changes.discovery?.productions).toEqual([]);
  });

  it('omits absent sections entirely', () => {
    const changes = normalizeMatterChanges({ caption: 'X v. Y' });
    expect(Object.keys(changes)).toEqual(['caption']);
  });
});

describe('normalizeMatterProposalDto', () => {
  const validProposal = {
    schemaVersion: 1,
    proposedAt: '2026-08-01T10:00:00.000Z',
    proposedBy: 'team-lead',
    summary: ['Motion to compel filed Jul 10, 2026'],
    changes: { discovery: { pendingMotion: { filed: 'Jul 10, 2026' } } },
    taskRefs: ['task-1', 42, ''],
  };

  it('round-trips a valid proposal and filters bad task refs', () => {
    const proposal = normalizeMatterProposalDto(validProposal);
    expect(proposal).not.toBeNull();
    expect(proposal?.proposedBy).toBe('team-lead');
    expect(proposal?.summary).toEqual(['Motion to compel filed Jul 10, 2026']);
    expect(proposal?.changes.discovery?.pendingMotion?.filed).toBe('Jul 10, 2026');
    expect(proposal?.taskRefs).toEqual(['task-1']);
  });

  it('returns null when identity or summary is missing', () => {
    expect(normalizeMatterProposalDto(null)).toBeNull();
    expect(normalizeMatterProposalDto({ ...validProposal, proposedAt: '' })).toBeNull();
    expect(normalizeMatterProposalDto({ ...validProposal, proposedBy: undefined })).toBeNull();
    expect(normalizeMatterProposalDto({ ...validProposal, summary: [] })).toBeNull();
  });
});
