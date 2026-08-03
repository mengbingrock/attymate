import { describe, expect, it, vi } from 'vitest';

import { LinkMatterEvidenceSourceAdapter } from '@features/matter-dashboard/main/adapters/output/link/LinkMatterEvidenceSourceAdapter';
import {
  LinkCommandUnavailableError,
  type LinkCommandRunner,
} from '@features/matter-dashboard/main/adapters/output/link/LinkCommandRunner';

function commandRunner(result: {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}): LinkCommandRunner {
  return {
    run: vi.fn(() =>
      Promise.resolve({
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      })
    ),
  };
}

describe('LinkMatterEvidenceSourceAdapter', () => {
  it('maps a ready Link ingest status into provider-neutral counts', async () => {
    const runner = commandRunner({
      stdout: JSON.stringify({
        source_count: 12,
        source_page_count: 12,
        represented_count: 12,
        pending_count: 0,
        stale_count: 0,
        raw_secret_warning_count: 0,
        has_wiki_dir: true,
        guidance: { state: 'ready', summary: 'All case files are represented.' },
      }),
    });
    const adapter = new LinkMatterEvidenceSourceAdapter(runner);

    const status = await adapter.getStatus({
      teamName: 'case-team',
      projectPath: '/cases/CaseNO.1234567',
    });

    expect(runner.run).toHaveBeenCalledWith(['ingest-status', '/cases/CaseNO.1234567', '--json']);
    expect(status).toMatchObject({
      source: 'link',
      projectPath: '/cases/CaseNO.1234567',
      state: 'ready',
      available: true,
      queryReady: true,
      providerState: 'ready',
      counts: {
        sourceFiles: 12,
        sourcePages: 12,
        representedFiles: 12,
        pendingFiles: 0,
        staleFiles: 0,
        secretWarnings: 0,
      },
    });
  });

  it.each([
    ['pending_raw', true, 'pending'],
    ['stale_raw', true, 'stale'],
    ['stale_graph', true, 'stale'],
    ['blocked_secrets', true, 'blocked'],
    ['missing_structure', false, 'not-initialized'],
    ['empty', true, 'empty'],
  ] as const)('maps Link state %s to %s', async (providerState, hasWiki, expectedState) => {
    const runner = commandRunner({
      exitCode: hasWiki ? 0 : 1,
      stdout: JSON.stringify({
        has_wiki_dir: hasWiki,
        guidance: { state: providerState, summary: providerState },
      }),
    });

    const status = await new LinkMatterEvidenceSourceAdapter(runner).getStatus({
      teamName: 'case-team',
      projectPath: '/cases/example',
    });

    expect(status.state).toBe(expectedState);
    expect(status.queryReady).toBe(false);
  });

  it('does not invoke Link when the team project cannot be resolved', async () => {
    const runner = commandRunner({});

    const status = await new LinkMatterEvidenceSourceAdapter(runner).getStatus({
      teamName: 'case-team',
      projectPath: null,
    });

    expect(status.state).toBe('project-unresolved');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('reports an unavailable Link executable without throwing across transports', async () => {
    const runner: LinkCommandRunner = {
      run: vi.fn(() => Promise.reject(new LinkCommandUnavailableError('lnk'))),
    };

    const status = await new LinkMatterEvidenceSourceAdapter(runner).getStatus({
      teamName: 'case-team',
      projectPath: '/cases/example',
    });

    expect(status).toMatchObject({
      state: 'source-unavailable',
      available: false,
      queryReady: false,
    });
  });

  it('converts malformed command output into a stable error status', async () => {
    const runner = commandRunner({ stdout: 'not json', stderr: 'unexpected output' });

    const status = await new LinkMatterEvidenceSourceAdapter(runner).getStatus({
      teamName: 'case-team',
      projectPath: '/cases/example',
    });

    expect(status).toMatchObject({
      state: 'error',
      available: true,
      queryReady: false,
      summary: 'unexpected output',
    });
  });

  it('initializes Link explicitly and then returns the refreshed status', async () => {
    const run = vi
      .fn<LinkCommandRunner['run']>()
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'initialized', stderr: '' })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          has_wiki_dir: true,
          guidance: { state: 'pending_raw', summary: 'Sources need ingest.' },
        }),
        stderr: '',
      });
    const adapter = new LinkMatterEvidenceSourceAdapter({ run });

    const status = await adapter.initialize({
      teamName: 'case-team',
      projectPath: '/cases/example',
    });

    expect(run).toHaveBeenNthCalledWith(1, ['init', '/cases/example']);
    expect(run).toHaveBeenNthCalledWith(2, ['ingest-status', '/cases/example', '--json']);
    expect(status.state).toBe('pending');
  });

  it('runs five bounded dashboard queries and deduplicates their evidence', async () => {
    const run = vi.fn<LinkCommandRunner['run']>().mockResolvedValue({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        recall_capsule: {
          items: [
            {
              name: 'operative-complaint',
              title: 'Operative complaint',
              summary: 'The amended complaint is the operative pleading.',
              why_selected: 'best matching wiki page',
              provenance: {
                path: 'wiki/sources/operative-complaint.md',
                source: 'pleadings/amended-complaint.pdf',
                date_updated: '2026-08-01',
              },
            },
          ],
        },
      }),
    });
    const adapter = new LinkMatterEvidenceSourceAdapter({ run });

    const bundle = await adapter.queryDashboardEvidence({
      teamName: 'case-team',
      projectPath: '/cases/example',
    });

    expect(run).toHaveBeenCalledTimes(5);
    expect(
      run.mock.calls.every(([args]) => args.includes('medium') && args.includes('--json'))
    ).toBe(true);
    expect(bundle.queryCount).toBe(5);
    expect(bundle.sourceRevision).toMatch(/^[a-f0-9]{24}$/);
    expect(bundle.evidence).toHaveLength(1);
    expect(bundle.evidence[0]?.reference).toMatchObject({
      path: 'wiki/sources/operative-complaint.md',
      source: 'pleadings/amended-complaint.pdf',
    });
  });

  it('prefers substantive context packet content and drops the generic wiki index', async () => {
    const substantive = `# Source Metadata\n\n## Extracted Content\n\n${'Grounded pleading fact. '.repeat(120)}`;
    const run = vi.fn<LinkCommandRunner['run']>().mockResolvedValue({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        recall_capsule: {
          items: [
            {
              name: 'shallow',
              summary: 'Indexed a file but omitted its substantive text.',
              provenance: { path: 'wiki/sources/shallow.md' },
            },
          ],
        },
        context_packet: [
          {
            name: 'operative-complaint',
            title: 'Operative complaint',
            content: substantive,
            provenance: { path: 'wiki/sources/operative-complaint.md' },
          },
          {
            name: 'index',
            content: 'Link Wiki Index',
            provenance: { path: 'wiki/index.md' },
          },
        ],
      }),
    });

    const bundle = await new LinkMatterEvidenceSourceAdapter({ run }).queryDashboardEvidence({
      teamName: 'case-team',
      projectPath: '/cases/example',
    });

    expect(bundle.evidence).toHaveLength(1);
    expect(bundle.evidence[0]?.reference.path).toBe('wiki/sources/operative-complaint.md');
    expect(bundle.evidence[0]?.summary).toMatch(/^Grounded pleading fact\./);
    expect(bundle.evidence[0]?.summary.length).toBe(2_400);
  });
});
