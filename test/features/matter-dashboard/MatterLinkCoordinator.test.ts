import { describe, expect, it, vi } from 'vitest';

import { MatterLinkCoordinator } from '@features/matter-dashboard/main/application/MatterLinkCoordinator';

import type { MatterEvidenceStatusDto } from '@features/matter-dashboard/contracts';
import type {
  MatterEvidenceQueryBundle,
  MatterEvidenceSourcePort,
} from '@features/matter-dashboard/core/application/ports/MatterEvidenceSourcePort';

function status(state: MatterEvidenceStatusDto['state']): MatterEvidenceStatusDto {
  return {
    source: 'link',
    checkedAt: '2026-08-02T00:00:00.000Z',
    projectPath: '/cases/example',
    state,
    available: true,
    queryReady: state === 'ready',
    summary: state,
    providerState: state,
    counts: {
      sourceFiles: 2,
      sourcePages: 1,
      representedFiles: 1,
      pendingFiles: state === 'pending' ? 1 : 0,
      staleFiles: state === 'stale' ? 1 : 0,
      secretWarnings: 0,
    },
  };
}

function harness(currentStatus: MatterEvidenceStatusDto) {
  const evidenceSource: MatterEvidenceSourcePort = {
    source: 'link',
    getStatus: vi.fn(() => Promise.resolve(currentStatus)),
    initialize: vi.fn(() => Promise.resolve(status('pending'))),
    queryDashboardEvidence: vi.fn(
      (): Promise<MatterEvidenceQueryBundle> =>
        Promise.resolve({
          source: 'link',
          generatedAt: '2026-08-02T00:00:00.000Z',
          sourceRevision: 'revision-123',
          queryCount: 5,
          evidence: [
            {
              topic: 'pleadings',
              summary: 'The amended complaint is operative.',
              reference: { path: 'wiki/sources/complaint.md' },
            },
          ],
        })
    ),
  };
  const notifyLead = vi.fn<(teamName: string, summary: string, text: string) => Promise<void>>(() =>
    Promise.resolve()
  );
  const coordinator = new MatterLinkCoordinator({
    resolveProjectPath: vi.fn(() => Promise.resolve('/cases/example')),
    evidenceSource,
    leadNotifier: { notifyLead },
  });
  return { coordinator, evidenceSource, notifyLead };
}

describe('MatterLinkCoordinator', () => {
  it('initializes through the provider and reports the resulting ingest state', async () => {
    const { coordinator, evidenceSource } = harness(status('not-initialized'));

    const result = await coordinator.initialize('case-team');

    expect(evidenceSource.initialize).toHaveBeenCalledWith({
      teamName: 'case-team',
      projectPath: '/cases/example',
    });
    expect(result).toMatchObject({ operation: 'initialize', accepted: true });
    expect(result.status.state).toBe('pending');
  });

  it('requests agent-assisted ingestion only for pending or stale evidence', async () => {
    const { coordinator, notifyLead } = harness(status('pending'));

    const result = await coordinator.requestRefresh('case-team');

    expect(result.accepted).toBe(true);
    expect(notifyLead).toHaveBeenCalledWith(
      'case-team',
      'Refresh Link matter evidence',
      expect.stringContaining('Do not read or ingest any source Link marks blocked')
    );
  });

  it('does not bypass a blocked Link safety state', async () => {
    const { coordinator, notifyLead } = harness(status('blocked'));

    const result = await coordinator.requestRefresh('case-team');

    expect(result.accepted).toBe(false);
    expect(notifyLead).not.toHaveBeenCalled();
  });

  it('sends bounded evidence and its revision to the lead for matter_propose', async () => {
    const { coordinator, evidenceSource, notifyLead } = harness(status('ready'));

    const result = await coordinator.requestProposal('case-team');

    expect(evidenceSource.queryDashboardEvidence).toHaveBeenCalled();
    expect(result).toMatchObject({
      operation: 'proposal-request',
      accepted: true,
      sourceRevision: 'revision-123',
      evidenceCount: 1,
    });
    expect(notifyLead).toHaveBeenCalledWith(
      'case-team',
      'Build Link-backed matter proposal',
      expect.stringContaining('sourceRevision')
    );
    expect(notifyLead.mock.calls[0]?.[2]).toContain('Do not broadly rescan the project folder');
  });
});
