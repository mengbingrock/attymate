const fs = require('fs');
const os = require('os');
const path = require('path');

const matterStore = require('../src/internal/matterStore.js');

describe('matterStore (global, team-independent store)', () => {
  const tempDirs = [];

  function makeContext(teamName = 'my-team') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-teams-matter-'));
    tempDirs.push(root);
    const teamDir = path.join(root, 'teams', teamName);
    fs.mkdirSync(teamDir, { recursive: true });
    return {
      teamName,
      paths: { teamDir, mattersDir: path.join(root, 'matters') },
    };
  }

  /** A second team sharing the same store as `context`. */
  function siblingContext(context, teamName) {
    const root = path.dirname(path.dirname(context.paths.teamDir));
    const teamDir = path.join(root, 'teams', teamName);
    fs.mkdirSync(teamDir, { recursive: true });
    return { teamName, paths: { teamDir, mattersDir: context.paths.mattersDir } };
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function readMatterFile(context, matterId) {
    return JSON.parse(
      fs.readFileSync(path.join(context.paths.mattersDir, matterId, 'matter.json'), 'utf8')
    );
  }

  it('throws when no matters dir is configured', () => {
    expect(() =>
      matterStore.getSnapshot({ teamName: 't', paths: { teamDir: '/tmp/nope' } })
    ).toThrow(/mattersDir/);
  });

  it('returns an empty snapshot for a fresh store', () => {
    const context = makeContext();
    expect(matterStore.getSnapshot(context)).toEqual({
      matters: [],
      linkedMatterIds: [],
      proposal: null,
    });
  });

  it('creates a matter linked to the calling team', () => {
    const context = makeContext();
    const { matter } = matterStore.createMatter(context, { caption: 'Smith v. Jones' });
    expect(matter.caption).toBe('Smith v. Jones');
    expect(matter.schemaVersion).toBe(2);
    expect(matter.updatedBy).toBe('user');
    // No team fields on the matter document itself.
    expect(Object.keys(matter)).not.toContain('teamName');
    expect(Object.keys(matter)).not.toContain('linkedTeams');

    const snapshot = matterStore.getSnapshot(context);
    expect(snapshot.matters.map((entry) => entry.id)).toEqual([matter.id]);
    expect(snapshot.linkedMatterIds).toEqual([matter.id]);
  });

  it('lists every matter store-wide but links per team', () => {
    const context = makeContext();
    const other = siblingContext(context, 'other-team');
    const mine = matterStore.createMatter(context, { caption: 'Mine' }).matter;
    const theirs = matterStore.createMatter(other, { caption: 'Theirs' }).matter;

    const snapshot = matterStore.getSnapshot(context);
    expect(snapshot.matters.map((entry) => entry.caption).sort()).toEqual(['Mine', 'Theirs']);
    expect(snapshot.linkedMatterIds).toEqual([mine.id]);
    expect(matterStore.getSnapshot(other).linkedMatterIds).toEqual([theirs.id]);
  });

  it('link and unlink edit the registry, never the matter document', () => {
    const context = makeContext();
    const other = siblingContext(context, 'other-team');
    const { matter } = matterStore.createMatter(context, { caption: 'Shared' });

    matterStore.linkTeam(other, matter.id);
    expect(matterStore.getSnapshot(other).linkedMatterIds).toEqual([matter.id]);
    expect(readMatterFile(context, matter.id)).toEqual(matter);

    matterStore.unlinkTeam(other, matter.id);
    expect(matterStore.getSnapshot(other).linkedMatterIds).toEqual([]);
    // Unlinking never deletes the matter.
    expect(matterStore.getSnapshot(context).matters).toHaveLength(1);
  });

  it('updateMatter merges sections, stamps user authorship and record ids', () => {
    const context = makeContext();
    const { matter } = matterStore.createMatter(context, { caption: 'Edit target' });
    const { matter: updated } = matterStore.updateMatter(context, {
      matterId: matter.id,
      changes: {
        status: 'Active',
        parties: [{ name: 'Daniel Anderson', side: 'Our client' }],
        discovery: { requests: [{ type: 'RFP' }] },
      },
    });
    expect(updated.status).toBe('Active');
    expect(updated.updatedBy).toBe('user');
    expect(updated.parties[0].id).toMatch(/^rec-/);
    expect(updated.discovery.requests[0].id).toMatch(/^rec-/);

    // Object sections shallow-merge; arrays replace wholesale.
    const { matter: second } = matterStore.updateMatter(context, {
      matterId: matter.id,
      changes: { discovery: { motions: [{ type: 'MTC' }] } },
    });
    expect(second.discovery.requests).toHaveLength(1);
    expect(second.discovery.motions).toHaveLength(1);
    expect(() =>
      matterStore.updateMatter(context, { matterId: 'm-missing', changes: { status: 'X' } })
    ).toThrow(/Unknown matter/);
    expect(() => matterStore.updateMatter(context, { matterId: matter.id, changes: {} })).toThrow(
      /non-empty/
    );
  });

  it('imports a legacy team matter.json once, leaving a stub', () => {
    const context = makeContext();
    const legacyPath = path.join(context.paths.teamDir, 'matter.json');
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({ schemaVersion: 1, caption: 'Legacy v. Old', currentStage: 'discovery' })
    );

    const snapshot = matterStore.getSnapshot(context);
    expect(snapshot.matters).toHaveLength(1);
    expect(snapshot.matters[0].caption).toBe('Legacy v. Old');
    expect(snapshot.linkedMatterIds).toEqual([snapshot.matters[0].id]);

    const stub = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
    expect(stub.migratedTo).toBe(snapshot.matters[0].id);

    // A second read must not import again.
    const again = matterStore.getSnapshot(context);
    expect(again.matters).toHaveLength(1);
  });

  it('does not import an empty legacy file and still stubs it', () => {
    const context = makeContext();
    const legacyPath = path.join(context.paths.teamDir, 'matter.json');
    fs.writeFileSync(legacyPath, JSON.stringify({ schemaVersion: 1 }));

    const snapshot = matterStore.getSnapshot(context);
    expect(snapshot.matters).toEqual([]);
    const stub = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
    expect(stub.schemaVersion).toBe(2);
    expect(stub.migratedTo).toBeUndefined();
  });

  it('imports a legacy pending proposal and targets the imported matter', () => {
    const context = makeContext();
    fs.writeFileSync(
      path.join(context.paths.teamDir, 'matter.json'),
      JSON.stringify({ schemaVersion: 1, caption: 'Legacy v. Old' })
    );
    fs.writeFileSync(
      path.join(context.paths.teamDir, 'matter-proposal.json'),
      JSON.stringify({
        schemaVersion: 1,
        proposedAt: '2026-08-01T10:00:00.000Z',
        proposedBy: 'team-lead',
        summary: ['MTC filed'],
        changes: { status: 'Active' },
      })
    );

    const snapshot = matterStore.getSnapshot(context);
    expect(snapshot.proposal).not.toBeNull();
    expect(snapshot.proposal.matterId).toBe(snapshot.matters[0].id);
    expect(fs.existsSync(path.join(context.paths.teamDir, 'matter-proposal.json'))).toBe(false);
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
      matterStore.submitProposal(context, { summary: ['a'], changes: { caption: 'X' }, matterId: ' ' })
    ).toThrow(/matterId/);
    expect(() =>
      matterStore.submitProposal(context, {
        summary: ['a'],
        changes: { caption: 'y'.repeat(300 * 1024) },
      })
    ).toThrow(/too large/);
  });

  it('resolves the sole linked matter when a proposal has no matterId', () => {
    const context = makeContext();
    const { matter } = matterStore.createMatter(context, { caption: 'Only one' });
    const record = matterStore.submitProposal(
      context,
      { summary: ['Status confirmed'], changes: { status: 'Active' } },
      'legal-ops-supervisor'
    );
    expect(record.matterId).toBe(matter.id);

    const { matter: applied } = matterStore.applyProposal(context, 'user');
    expect(applied.id).toBe(matter.id);
    expect(applied.status).toBe('Active');
    expect(applied.updatedBy).toBe('legal-ops-supervisor');
    expect(applied.approvedBy).toBe('user');
    expect(matterStore.readProposal(context)).toBeNull();
  });

  it('demands an explicit matterId when several matters are linked', () => {
    const context = makeContext();
    const first = matterStore.createMatter(context, { caption: 'First' }).matter;
    matterStore.createMatter(context, { caption: 'Second' });
    expect(() =>
      matterStore.submitProposal(context, { summary: ['x'], changes: { status: 'Active' } })
    ).toThrow(/matterId is required/);

    const record = matterStore.submitProposal(context, {
      summary: ['x'],
      changes: { status: 'Active' },
      matterId: first.id,
    });
    expect(record.matterId).toBe(first.id);
    const { matter } = matterStore.applyProposal(context, 'user');
    expect(matter.id).toBe(first.id);
  });

  it('rejects a proposal naming an unknown matter', () => {
    const context = makeContext();
    expect(() =>
      matterStore.submitProposal(context, {
        summary: ['x'],
        changes: { status: 'Active' },
        matterId: 'm-does-not-exist',
      })
    ).toThrow(/Unknown matter/);
  });

  it('a matterless team proposal creates and links the matter on apply', () => {
    const context = makeContext();
    matterStore.submitProposal(
      context,
      { summary: ['Initial scan'], changes: { caption: 'Fresh v. Case', status: 'Active' } },
      'team-lead'
    );
    const { matter } = matterStore.applyProposal(context, 'user');
    expect(matter.caption).toBe('Fresh v. Case');
    const snapshot = matterStore.getSnapshot(context);
    expect(snapshot.linkedMatterIds).toEqual([matter.id]);
  });

  it('rejectProposal clears without applying', () => {
    const context = makeContext();
    matterStore.createMatter(context, { caption: 'Untouched' });
    matterStore.submitProposal(context, { summary: ['x'], changes: { status: 'Closed' } });
    const rejected = matterStore.rejectProposal(context);
    expect(rejected.changes.status).toBe('Closed');
    const snapshot = matterStore.getSnapshot(context);
    expect(snapshot.proposal).toBeNull();
    expect(snapshot.matters[0].status).toBeUndefined();
    expect(() => matterStore.rejectProposal(context)).toThrow(/No pending/);
  });

  it('resolves the store from AGENT_TEAMS_MATTERS_DIR when the context has none', () => {
    const context = makeContext();
    const envContext = { teamName: context.teamName, paths: { teamDir: context.paths.teamDir } };
    process.env.AGENT_TEAMS_MATTERS_DIR = context.paths.mattersDir;
    try {
      matterStore.createMatter(envContext, { caption: 'Via env' });
      expect(matterStore.getSnapshot(context).matters.map((m) => m.caption)).toEqual(['Via env']);
    } finally {
      delete process.env.AGENT_TEAMS_MATTERS_DIR;
    }
  });
});
