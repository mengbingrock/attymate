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
  });
});
