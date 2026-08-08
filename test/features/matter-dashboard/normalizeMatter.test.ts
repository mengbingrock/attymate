import {
  hasMatterContent,
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

  it('returns null without an id or fallback id, and prefers the stored id', () => {
    expect(normalizeMatterDto({ caption: 'X v. Y' })).toBeNull();
    expect(normalizeMatterDto({ caption: 'X v. Y' }, 'fallback-1')?.id).toBe('fallback-1');
    expect(normalizeMatterDto({ id: 'matter-9', caption: 'X v. Y' }, 'fallback-1')?.id).toBe(
      'matter-9'
    );
  });

  it('normalizes a v2 document, dropping unknown keys and bad entries', () => {
    const dto = normalizeMatterDto({
      schemaVersion: 2,
      id: 'matter-1',
      createdAt: '2026-03-12T09:14:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      updatedBy: 'team-lead',
      approvedBy: 'user',
      caption: '  Smith v. Jones  ',
      status: 'Active',
      matterNumber: 'SM-1',
      currentStage: 'settlement',
      unknownSection: { anything: true },
      coreFields: [{ label: 'Client', value: 'A. Smith' }, { label: '' }, 'garbage'],
      nextDeadline: { date: 'Sep 1, 2026', label: 'Trial brief' },
      parties: [
        { id: 'pty-a', name: 'A. Smith', side: 'Our client', kind: 'Individual' },
        { role: 'nameless is dropped' },
      ],
      counsel: [{ name: 'K. Lin', partyId: 'pty-a', role: 'Lead counsel' }],
      discovery: {
        requests: [{ type: 'RFP', status: 'Served', issued: 'Aug 1, 2025' }, { set: 'no type' }],
        motions: [{ type: 'MTC', outcome: 'Pending', ruled: '' }],
      },
      settlement: {
        records: [{ date: 'Jul 15, 2026', type: 'Counteroffer', amount: '$310,000' }],
        mediations: [{ when: 'Sep 24, 2026', status: 'Scheduled' }],
      },
      events: [{ date: 'Mar 12, 2025', type: 'Filed', description: 'Complaint filed' }, {}],
    });

    expect(dto).not.toBeNull();
    expect(dto?.schemaVersion).toBe(2);
    expect(dto?.id).toBe('matter-1');
    expect(dto?.caption).toBe('Smith v. Jones');
    expect(dto?.currentStage).toBe('settlement');
    expect(dto?.parties).toEqual([
      { id: 'pty-a', name: 'A. Smith', side: 'Our client', kind: 'Individual' },
    ]);
    expect(dto?.counsel?.[0]).toMatchObject({ name: 'K. Lin', partyId: 'pty-a' });
    expect(dto?.counsel?.[0].id).toBe('counsel-1');
    expect(dto?.discovery?.requests).toEqual([
      { id: 'request-1', type: 'RFP', status: 'Served', issued: 'Aug 1, 2025' },
    ]);
    expect(dto?.discovery?.motions).toEqual([{ id: 'motion-1', type: 'MTC', outcome: 'Pending' }]);
    expect(dto?.settlement?.records?.[0]).toMatchObject({ amount: '$310,000' });
    expect(dto?.settlement?.mediations?.[0]).toMatchObject({ status: 'Scheduled' });
    expect(dto?.events).toEqual([
      { id: 'event-1', date: 'Mar 12, 2025', type: 'Filed', description: 'Complaint filed' },
    ]);
    expect((dto as unknown as Record<string, unknown>).unknownSection).toBeUndefined();
  });

  it('migrates a v1 document into the v2 shape', () => {
    const dto = normalizeMatterDto(
      {
        schemaVersion: 1,
        caption: 'Legacy v. Old',
        currentStage: 'discovery',
        coreFields: [
          { label: 'Client', value: 'Legacy LLC' },
          { label: 'Case No.', value: '24STCV0001' },
          { label: 'Department', value: 'Dept. 32' },
        ],
        pleading: {
          operativePleading: 'First Amended Complaint',
          amendmentDeadline: 'Jun 30, 2025',
          causesOfAction: 'Breach of contract',
        },
        discovery: {
          pendingMotion: { motionType: 'Motion to Compel', relatedRequest: 'SI Set Two' },
          meetConfer: { date: 'Jun 3, 2026', outcome: 'Unresolved', notes: 'Privilege dispute' },
          productions: [{ type: 'Initial', bates: 'MER000001–004212' }],
        },
        trial: {
          trialDate: 'Feb 8, 2027',
          trialType: 'Jury Trial',
          estimatedDuration: '7 days',
          settingStatus: 'Set',
          continuancesNote: 'Reset from Sep 14, 2026',
        },
        postJudgment: { enforcementActions: 'Renewal review Nov 2026' },
      },
      'imported-1'
    );

    expect(dto?.schemaVersion).toBe(2);
    expect(dto?.client).toBe('Legacy LLC');
    expect(dto?.caseNumber).toBe('24STCV0001');
    expect(dto?.department).toBe('Dept. 32');
    expect(dto?.pleading?.records).toEqual([
      {
        id: 'pleading-1',
        type: 'First Amended Complaint',
        status: 'Operative',
        amendmentDue: 'Jun 30, 2025',
        claims: 'Breach of contract',
      },
    ]);
    expect(dto?.discovery?.motions).toEqual([
      { id: 'motion-1', type: 'Motion to Compel', request: 'SI Set Two' },
    ]);
    expect(dto?.discovery?.meetAndConfers).toEqual([
      { id: 'meet-confer-1', date: 'Jun 3, 2026', outcome: 'Unresolved', dispute: 'Privilege dispute' },
    ]);
    expect(dto?.discovery?.productions?.[0]).toMatchObject({ id: 'production-1', type: 'Initial' });
    expect(dto?.trial?.settings).toEqual([
      { id: 'setting-1', type: 'Jury Trial', trialDate: 'Feb 8, 2027', days: '7 days', status: 'Set' },
    ]);
    expect(dto?.trial?.continuances).toEqual([
      { id: 'continuance-1', text: 'Reset from Sep 14, 2026' },
    ]);
    expect(dto?.postJudgment?.enforcementActions).toEqual([
      { id: 'enforcement-1', detail: 'Renewal review Nov 2026' },
    ]);
  });

  it('drops invalid stage ids and incomplete deadlines instead of throwing', () => {
    const dto = normalizeMatterDto(
      {
        currentStage: 'appeal',
        nextDeadline: { date: 'Sep 1, 2026' },
        stages: [{ id: 'settlement', summary: 'mediation scheduled' }, { id: 'bogus' }],
      },
      'm-1'
    );
    expect(dto?.currentStage).toBeUndefined();
    expect(dto?.nextDeadline).toBeUndefined();
    expect(dto?.stages).toEqual([{ id: 'settlement', summary: 'mediation scheduled' }]);
  });
});

describe('normalizeMatterChanges', () => {
  it('preserves present-but-empty arrays (wholesale replacement semantics)', () => {
    const changes = normalizeMatterChanges({
      coreFields: [],
      parties: [],
      discovery: { productions: [] },
    });
    expect(changes.coreFields).toEqual([]);
    expect(changes.parties).toEqual([]);
    expect(changes.discovery?.productions).toEqual([]);
  });

  it('omits absent sections entirely', () => {
    const changes = normalizeMatterChanges({ caption: 'X v. Y' });
    expect(Object.keys(changes)).toEqual(['caption']);
  });

  it('keeps agent-provided record ids stable', () => {
    const changes = normalizeMatterChanges({
      discovery: { requests: [{ id: 'rec-keep', type: 'RFA' }, { type: 'RFP' }] },
    });
    expect(changes.discovery?.requests?.map((request) => request.id)).toEqual([
      'rec-keep',
      'request-2',
    ]);
  });
});

describe('hasMatterContent', () => {
  it('is false for bookkeeping-only documents and migration stubs', () => {
    expect(hasMatterContent({ schemaVersion: 1 })).toBe(false);
    expect(hasMatterContent({ schemaVersion: 2, migratedTo: 'matter-1' })).toBe(false);
    expect(hasMatterContent(null)).toBe(false);
  });

  it('is true when any real section is present', () => {
    expect(hasMatterContent({ schemaVersion: 1, caption: 'X v. Y' })).toBe(true);
    expect(hasMatterContent({ schemaVersion: 1, coreFields: [] })).toBe(true);
  });
});

describe('normalizeMatterProposalDto', () => {
  const validProposal = {
    schemaVersion: 2,
    matterId: 'matter-7',
    proposedAt: '2026-08-01T10:00:00.000Z',
    proposedBy: 'team-lead',
    summary: ['Motion to compel filed Jul 10, 2026'],
    changes: { discovery: { motions: [{ type: 'MTC', filed: 'Jul 10, 2026' }] } },
    taskRefs: ['task-1', 42, ''],
    sourceMode: 'link',
    sourceRevision: 'revision-123',
    evidence: [
      {
        path: 'wiki/sources/motion.md',
        source: 'filings/motion.pdf',
        fieldPaths: ['discovery.motions.filed', ''],
      },
      { title: 'missing path' },
    ],
  };

  it('round-trips a valid proposal and filters bad task refs', () => {
    const proposal = normalizeMatterProposalDto(validProposal);
    expect(proposal).not.toBeNull();
    expect(proposal?.matterId).toBe('matter-7');
    expect(proposal?.proposedBy).toBe('team-lead');
    expect(proposal?.summary).toEqual(['Motion to compel filed Jul 10, 2026']);
    expect(proposal?.changes.discovery?.motions?.[0].filed).toBe('Jul 10, 2026');
    expect(proposal?.taskRefs).toEqual(['task-1']);
    expect(proposal?.sourceMode).toBe('link');
    expect(proposal?.sourceRevision).toBe('revision-123');
    expect(proposal?.evidence).toEqual([
      {
        path: 'wiki/sources/motion.md',
        source: 'filings/motion.pdf',
        fieldPaths: ['discovery.motions.filed'],
      },
    ]);
  });

  it('accepts a legacy v1 proposal without matterId, migrating its changes', () => {
    const proposal = normalizeMatterProposalDto({
      schemaVersion: 1,
      proposedAt: '2026-08-01T10:00:00.000Z',
      proposedBy: 'team-lead',
      summary: ['MTC filed'],
      changes: { discovery: { pendingMotion: { motionType: 'MTC', filed: 'Jul 10, 2026' } } },
    });
    expect(proposal?.matterId).toBeUndefined();
    expect(proposal?.changes.discovery?.motions).toEqual([
      { id: 'motion-1', type: 'MTC', filed: 'Jul 10, 2026' },
    ]);
  });

  it('returns null when identity or summary is missing', () => {
    expect(normalizeMatterProposalDto(null)).toBeNull();
    expect(normalizeMatterProposalDto({ ...validProposal, proposedAt: '' })).toBeNull();
    expect(normalizeMatterProposalDto({ ...validProposal, proposedBy: undefined })).toBeNull();
    expect(normalizeMatterProposalDto({ ...validProposal, summary: [] })).toBeNull();
  });
});
