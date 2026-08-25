// @vitest-environment node

import { fileURLToPath } from 'node:url';

import { CodexAppServerProcessFactory } from '@claude-teams/agent-teams-worker';
import { describe, expect, it } from 'vitest';

describe('CodexAppServerProcessFactory', () => {
  it('keeps a stdio session open and responds to numeric-id server requests', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/fakeCodexAppServer.mjs', import.meta.url));
    const serverRequests: string[] = [];
    const factory = new CodexAppServerProcessFactory({
      binaryPath: process.execPath,
      launcherArgs: [fixture],
      onServerRequest: async (request) => {
        serverRequests.push(request.method);
        return { decision: 'decline' };
      },
    });
    const session = await factory.open();

    try {
      await expect(session.request('fixture/getInitializeParams')).resolves.toMatchObject({
        capabilities: {
          optOutNotificationMethods: ['item/agentReasoning/delta'],
        },
      });
      await expect(session.request('fixture/getArgv')).resolves.toEqual([
        '--disable',
        'apps',
        '--disable',
        'plugins',
        '--disable',
        'remote_plugin',
        'app-server',
      ]);
      await expect(session.request('thread/start')).resolves.toEqual({
        thread: { id: 'thr_fixture' },
      });
      const response = await new Promise<unknown>((resolve) => {
        const unsubscribe = session.onNotification((notification) => {
          if (notification.method !== 'fixture/serverRequestResolved') return;
          unsubscribe();
          resolve(notification.params);
        });
      });
      expect(serverRequests).toEqual(['item/commandExecution/requestApproval']);
      expect(response).toMatchObject({ id: 900, result: { decision: 'decline' } });
      const closed = new Promise<Error>((resolve) => {
        session.onClose((event) => resolve(event.error));
      });
      await expect(session.request('fixture/crash')).rejects.toThrow(
        'Codex app-server exited (code=17'
      );
      await expect(closed).resolves.toMatchObject({
        message: expect.stringContaining('Codex app-server exited (code=17'),
      });
    } finally {
      await session.close();
    }
  }, 30_000);

  it('keeps App Server requests pending until the remote owner resolves them', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/fakeCodexAppServer.mjs', import.meta.url));
    const factory = new CodexAppServerProcessFactory({
      binaryPath: process.execPath,
      launcherArgs: [fixture],
    });
    const session = await factory.open();

    try {
      const request = await new Promise<{ id: number | string; method: string }>((resolve) => {
        session.onRequest((incoming) => resolve(incoming));
      });
      expect(request).toMatchObject({
        id: 900,
        method: 'item/commandExecution/requestApproval',
      });
      session.respondToRequest(request.id, { decision: 'accept' });
      const response = await new Promise<unknown>((resolve) => {
        const unsubscribe = session.onNotification((notification) => {
          if (notification.method !== 'fixture/serverRequestResolved') return;
          unsubscribe();
          resolve(notification.params);
        });
      });
      expect(response).toMatchObject({ id: 900, result: { decision: 'accept' } });

      const stringRequestPromise = new Promise<{ id: number | string; method: string }>(
        (resolve) => {
          const unsubscribe = session.onRequest((incoming) => {
            if (incoming.id !== 'approval-901') return;
            unsubscribe();
            resolve(incoming);
          });
        }
      );
      await session.request('fixture/requestStringApproval');
      const stringRequest = await stringRequestPromise;
      expect(stringRequest).toMatchObject({
        id: 'approval-901',
        method: 'item/fileChange/requestApproval',
      });
      session.respondToRequest(stringRequest.id, { decision: 'acceptForSession' });
      const stringResponse = await new Promise<unknown>((resolve) => {
        const unsubscribe = session.onNotification((notification) => {
          if (
            notification.method !== 'fixture/serverRequestResolved' ||
            (notification.params as { id?: unknown }).id !== 'approval-901'
          ) {
            return;
          }
          unsubscribe();
          resolve(notification.params);
        });
      });
      expect(stringResponse).toMatchObject({
        id: 'approval-901',
        result: { decision: 'acceptForSession' },
      });
    } finally {
      await session.close();
    }
  });

  it('launches App Server with the Worker-owned Codex home environment', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/fakeCodexAppServer.mjs', import.meta.url));
    const factory = new CodexAppServerProcessFactory({
      binaryPath: process.execPath,
      launcherArgs: [fixture],
      env: { ...process.env, CODEX_HOME: '/isolated/worker/codex-home' },
    });
    const session = await factory.open();

    try {
      await expect(session.request('fixture/getCodexHome')).resolves.toBe(
        '/isolated/worker/codex-home'
      );
    } finally {
      await session.close();
    }
  });
});
