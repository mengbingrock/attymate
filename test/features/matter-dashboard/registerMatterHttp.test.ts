import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { MATTER_ROUTE } from '@features/matter-dashboard/contracts';
import { registerMatterHttp } from '@features/matter-dashboard/main/adapters/input/http/registerMatterHttp';

import type { MatterFeatureFacade } from '@features/matter-dashboard/main';

describe('matter Link status HTTP', () => {
  it('forwards a valid team name through the browser-parity route', async () => {
    const app = Fastify();
    const getLinkStatus = vi.fn(() =>
      Promise.resolve({
        source: 'link' as const,
        checkedAt: '2026-08-02T00:00:00.000Z',
        projectPath: '/cases/example',
        state: 'ready' as const,
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
    );
    registerMatterHttp(app, { getLinkStatus } as unknown as MatterFeatureFacade);

    const response = await app.inject({
      method: 'GET',
      url: `${MATTER_ROUTE}/link-status?teamName=case-team`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ source: 'link', state: 'ready', queryReady: true });
    expect(getLinkStatus).toHaveBeenCalledWith('case-team');
    await app.close();
  });

  it('returns 400 when teamName is missing', async () => {
    const app = Fastify();
    const getLinkStatus = vi.fn();
    registerMatterHttp(app, { getLinkStatus } as unknown as MatterFeatureFacade);

    const response = await app.inject({ method: 'GET', url: `${MATTER_ROUTE}/link-status` });

    expect(response.statusCode).toBe(400);
    expect(getLinkStatus).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    ['link-initialize', 'initializeLink'],
    ['link-refresh', 'requestLinkRefresh'],
    ['link-proposal', 'requestLinkProposal'],
  ] as const)('provides browser parity for %s', async (path, method) => {
    const app = Fastify();
    const operation = vi.fn(() =>
      Promise.resolve({
        operation: 'initialize' as const,
        accepted: true,
        message: 'accepted',
        status: {
          source: 'link' as const,
          checkedAt: '2026-08-02T00:00:00.000Z',
          projectPath: '/cases/example',
          state: 'ready' as const,
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
        },
      })
    );
    registerMatterHttp(app, { [method]: operation } as unknown as MatterFeatureFacade);

    const response = await app.inject({
      method: 'POST',
      url: `${MATTER_ROUTE}/${path}`,
      payload: { teamName: 'case-team' },
    });

    expect(response.statusCode).toBe(200);
    expect(operation).toHaveBeenCalledWith('case-team');
    await app.close();
  });
});
