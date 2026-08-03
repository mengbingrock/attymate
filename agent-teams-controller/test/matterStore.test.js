const fs = require('fs');
const os = require('os');
const path = require('path');

const matterStore = require('../src/internal/matterStore.js');

describe('matterStore', () => {
  const tempDirs = [];

  function makeContext() {
    const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-teams-matter-'));
    tempDirs.push(teamDir);
    return { teamName: 'my-team', paths: { teamDir } };
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function readFileJson(context, name) {
    return JSON.parse(fs.readFileSync(path.join(context.paths.teamDir, name), 'utf8'));
  }

  it('returns null for missing matter and proposal files', () => {
    const context = makeContext();
    expect(matterStore.readMatter(context)).toBeNull();
    expect(matterStore.readProposal(context)).toBeNull();
  });

  it('treats corrupt files as absent', () => {
    const context = makeContext();
    fs.writeFileSync(path.join(context.paths.teamDir, 'matter.json'), '{not json');
    fs.writeFileSync(path.join(context.paths.teamDir, 'matter-proposal.json'), '[]');
    expect(matterStore.readMatter(context)).toBeNull();
    expect(matterStore.readProposal(context)).toBeNull();
  });

  it('validates proposal input', () => {
    const context = makeContext();
    expect(() => matterStore.submitProposal(context, null)).toThrow(/must be an object/);
    expect(() =>
      matterStore.submitProposal(context, { summary: [], changes: { caption: 'X' } })
    ).toThrow(/summary/);
    expect(() => matterStore.submitProposal(context, { summary: ['a'], changes: {} })).toThrow(
      /changes/
    );
    expect(() =>
      matterStore.submitProposal(context, {
        summary: ['a'],
        changes: { caption: 'X' },
        taskRefs: 'x',
      })
    ).toThrow(/taskRefs/);
    expect(() =>
      matterStore.submitProposal(context, {
        summary: ['a'],
        changes: { caption: 'y'.repeat(300 * 1024) },
      })
    ).toThrow(/too large/);
  });

  it('writes a stamped proposal and overwrites on re-propose', () => {
    const context = makeContext();
    const first = matterStore.submitProposal(
      context,
      { summary: [' first '], changes: { caption: 'A v. B' }, taskRefs: ['t1'] },
      'lead-alice'
    );
    expect(first.schemaVersion).toBe(1);
    expect(first.proposedBy).toBe('lead-alice');
    expect(first.summary).toEqual(['first']);
    expect(typeof first.proposedAt).toBe('string');

    const second = matterStore.submitProposal(
      context,
      { summary: ['second'], changes: { status: 'Completed' } },
      undefined
    );
    expect(second.proposedBy).toBe('team-lead');
    const onDisk = readFileJson(context, 'matter-proposal.json');
    expect(onDisk.summary).toEqual(['second']);
    expect(onDisk.taskRefs).toBeUndefined();
  });

  it('preserves Link evidence metadata on a pending proposal', () => {
    const context = makeContext();
    const proposal = matterStore.submitProposal(
      context,
      {
        summary: ['operative complaint confirmed'],
        changes: { pleading: { operativePleading: 'First Amended Complaint' } },
        sourceMode: 'link',
        sourceRevision: 'revision-123',
        evidence: [
          {
            path: 'wiki/sources/complaint.md',
            source: 'pleadings/complaint.pdf',
            fieldPaths: ['pleading.operativePleading'],
          },
        ],
      },
      'team-lead'
    );

    expect(proposal.sourceMode).toBe('link');
    expect(proposal.sourceRevision).toBe('revision-123');
    expect(proposal.evidence).toHaveLength(1);
    expect(readFileJson(context, 'matter-proposal.json').evidence[0].path).toBe(
      'wiki/sources/complaint.md'
    );
  });

  it('errors when applying or rejecting with no pending proposal', () => {
    const context = makeContext();
    expect(() => matterStore.applyProposal(context, 'user')).toThrow(/No pending/);
    expect(() => matterStore.rejectProposal(context)).toThrow(/No pending/);
  });

  it('applies a proposal onto an empty matter and clears the proposal file', () => {
    const context = makeContext();
    matterStore.submitProposal(
      context,
      { summary: ['init'], changes: { caption: 'A v. B', currentStage: 'discovery' } },
      'team-lead'
    );
    const { matter, proposal } = matterStore.applyProposal(context, 'user');
    expect(matter.caption).toBe('A v. B');
    expect(matter.currentStage).toBe('discovery');
    expect(matter.schemaVersion).toBe(1);
    expect(matter.updatedBy).toBe('team-lead');
    expect(matter.approvedBy).toBe('user');
    expect(typeof matter.updatedAt).toBe('string');
    expect(proposal.summary).toEqual(['init']);
    expect(matterStore.readProposal(context)).toBeNull();
    expect(matterStore.readMatter(context).caption).toBe('A v. B');
  });

  it('merges sections shallowly, preserves untouched sections, replaces arrays wholesale', () => {
    const context = makeContext();
    matterStore.submitProposal(
      context,
      {
        summary: ['seed'],
        changes: {
          caption: 'A v. B',
          coreFields: [{ label: 'Client', value: 'Old' }],
          discovery: {
            statusNote: 'in progress',
            requests: [{ type: 'RFP', status: 'Served' }],
            pendingMotion: { motionType: 'MTC', filed: 'Jul 10, 2026' },
          },
          trial: { trialDate: 'Feb 8, 2027' },
        },
      },
      'team-lead'
    );
    matterStore.applyProposal(context, 'user');

    matterStore.submitProposal(
      context,
      {
        summary: ['update'],
        changes: {
          coreFields: [
            { label: 'Client', value: 'New' },
            { label: 'Judge', value: 'Hon. X' },
          ],
          discovery: {
            requests: [{ type: 'RFP', status: 'Complete' }],
            pendingMotion: { outcome: 'Granted' },
          },
        },
      },
      'team-lead'
    );
    const { matter } = matterStore.applyProposal(context, 'user');

    // Untouched sections survive.
    expect(matter.caption).toBe('A v. B');
    expect(matter.trial).toEqual({ trialDate: 'Feb 8, 2027' });
    // Arrays replace wholesale.
    expect(matter.coreFields).toEqual([
      { label: 'Client', value: 'New' },
      { label: 'Judge', value: 'Hon. X' },
    ]);
    expect(matter.discovery.requests).toEqual([{ type: 'RFP', status: 'Complete' }]);
    // Object sections merge shallowly: statusNote survives, pendingMotion is
    // replaced as a whole (shallow merge is one level deep).
    expect(matter.discovery.statusNote).toBe('in progress');
    expect(matter.discovery.pendingMotion).toEqual({ outcome: 'Granted' });
  });

  it('treats a corrupt matter file as empty when applying', () => {
    const context = makeContext();
    fs.writeFileSync(path.join(context.paths.teamDir, 'matter.json'), '{oops');
    matterStore.submitProposal(
      context,
      { summary: ['fix'], changes: { caption: 'Fresh' } },
      'team-lead'
    );
    const { matter } = matterStore.applyProposal(context, 'user');
    expect(matter.caption).toBe('Fresh');
  });

  it('rejectProposal clears the file and returns the rejected proposal', () => {
    const context = makeContext();
    matterStore.submitProposal(
      context,
      { summary: ['try'], changes: { caption: 'X' } },
      'team-lead'
    );
    const rejected = matterStore.rejectProposal(context);
    expect(rejected.summary).toEqual(['try']);
    expect(matterStore.readProposal(context)).toBeNull();
    expect(matterStore.readMatter(context)).toBeNull();
  });
});
