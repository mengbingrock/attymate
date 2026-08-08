import { describe, expect, it, vi } from 'vitest';

import { createMatterFeature } from '@features/matter-dashboard/main';

import type { MatterEvidenceStatusDto } from '@features/matter-dashboard/contracts';
import type {
  MatterEvidenceContext,
  MatterEvidenceSourcePort,
} from '@features/matter-dashboard/core/application/ports/MatterEvidenceSourcePort';

describe('createMatterFeature Link status', () => {
  it('resolves the team project and delegates through the evidence-source port', async () => {
    const evidenceSource: MatterEvidenceSourcePort = {
      source: 'link',
      getStatus: vi.fn(
        (context: MatterEvidenceContext): Promise<MatterEvidenceStatusDto> =>
          Promise.resolve({
            source: 'link',
            checkedAt: '2026-08-02T00:00:00.000Z',
            projectPath: context.projectPath,
            state: 'ready',
            available: true,
            queryReady: true,
            summary: 'ready',
            counts: {
              sourceFiles: 1,
              sourcePages: 1,
              representedFiles: 1,
              pendingFiles: 0,
              staleFiles: 0,
              secretWarnings: 0,
            },
          })
      ),
      initialize: vi.fn(),
      queryDashboardEvidence: vi.fn(),
    };
    const resolveProjectPath = vi.fn(() => Promise.resolve('/cases/example'));
    const feature = createMatterFeature({
      teamsBasePath: '/teams',
      resolveProjectPath,
      evidenceSource,
      leadNotifier: { notifyLead: vi.fn() },
      actions: {
        getSnapshot: vi.fn(() => ({ matters: [], linkedMatterIds: [], proposal: null })),
        updateMatter: vi.fn(),
        createMatter: vi.fn(),
        linkTeam: vi.fn(),
        unlinkTeam: vi.fn(),
        applyProposal: vi.fn(() => Promise.resolve()),
        rejectProposal: vi.fn(() => Promise.resolve()),
      },
      skillSeeder: {
        seed: vi.fn(() => Promise.resolve()),
        readInstalledMarkdown: vi.fn(() => Promise.resolve(null)),
      },
    });

    const status = await feature.getLinkStatus('case-team');

    expect(resolveProjectPath).toHaveBeenCalledWith('case-team');
    expect(evidenceSource.getStatus).toHaveBeenCalledWith({
      teamName: 'case-team',
      projectPath: '/cases/example',
    });
    expect(status.state).toBe('ready');
  });
});
