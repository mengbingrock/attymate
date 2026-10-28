// @vitest-environment node
import { Window } from 'happy-dom';

import {
  ACCOUNT_PORTAL_JS,
  accountPortalHtml,
} from '../../../../packages/agent-teams-relay/src/accountPortal/accountAssets';
import {
  JOIN_PORTAL_APP_JS,
  JOIN_PORTAL_HTML,
} from '../../../../packages/agent-teams-relay/src/relayJoinPortalAssets';

const team = {
  teamId: '7f2c1628-0000-4000-8000-000000000001',
  name: 'Setup test',
  role: 'owner',
  members: [],
  agents: [],
  devices: [],
  invites: [],
};

const fixture = async (kind: 'account' | 'legacy', genericStock: boolean) => {
  const browser = new Window({
    url: 'https://relay.example/join/?team=' + team.teamId,
    settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  });
  const requests: Record<string, unknown>[] = [];
  const runtimes = genericStock
    ? [
        {
          id: 'stock',
          label: 'Use installed Codex',
          installerAvailable: true,
          installerPlatforms: [],
        },
      ]
    : [];
  browser.fetch = vi.fn(async (input, options) => {
    const path = String(input);
    if (path.endsWith('/installer')) {
      requests.push(JSON.parse(String(options?.body)));
      return new browser.Response('test-only stock worker installer');
    }
    if (path.endsWith('/session'))
      return new browser.Response(
        JSON.stringify({
          configured: true,
          user: { id: 'owner', name: 'Test Owner', email: 'owner@example.test' },
          csrf: 'test-csrf',
          installerRuntimes: runtimes,
        })
      );
    if (path.endsWith('/verify'))
      return new browser.Response(JSON.stringify({ team, installerRuntimes: runtimes }));
    return new browser.Response(JSON.stringify({ teams: [team], team }));
  }) as typeof browser.fetch;
  browser.URL.createObjectURL = vi.fn(() => 'blob:test-stock-installer');
  browser.URL.revokeObjectURL = vi.fn();
  const downloads: string[] = [];
  const click = vi
    .spyOn(browser.HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: { download: string }) {
      downloads.push(this.download);
    });
  const element = (id: string) => browser.document.getElementById(id)!;
  const selectPlatform = (platform: string) => {
    if (kind === 'account') {
      const platforms = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64'];
      (
        element('platform-buttons').children[
          platforms.indexOf(platform)
        ] as unknown as HTMLButtonElement
      ).click();
    } else {
      (element('platform') as unknown as HTMLSelectElement).value = platform;
      element('platform').dispatchEvent(new browser.Event('change'));
    }
  };
  browser.document.write(
    kind === 'account' ? accountPortalHtml('https://relay.example') : JOIN_PORTAL_HTML
  );
  browser.eval(kind === 'account' ? ACCOUNT_PORTAL_JS : JOIN_PORTAL_APP_JS);
  browser.document.dispatchEvent(new browser.Event('DOMContentLoaded'));
  if (kind === 'account') {
    await vi.waitFor(() => expect(element('runtime-buttons').children).toHaveLength(2));
    (element('runtime-buttons').children[1] as unknown as HTMLButtonElement).click();
  } else {
    await vi.waitFor(() => expect(browser.document.querySelector('#teams button')).not.toBeNull());
    (browser.document.querySelector('#teams button') as unknown as HTMLButtonElement).click();
    (element('token') as unknown as HTMLInputElement).value = 'atj_test-only';
    (element('label') as unknown as HTMLInputElement).value = 'test-mac';
    element('unlock').dispatchEvent(new browser.Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(element('unlocked').hasAttribute('hidden')).toBe(false));
    (element('runtime') as unknown as HTMLSelectElement).value = 'stock';
    element('runtime').dispatchEvent(new browser.Event('change'));
  }
  selectPlatform('darwin-arm64');
  return {
    browser,
    element,
    requests,
    downloads,
    selectPlatform,
    download: element(
      kind === 'account' ? 'download-installer' : 'download'
    ) as unknown as HTMLButtonElement,
    recovery: element(kind === 'account' ? 'local-server-instructions' : 'option-attach'),
    unavailable: element(kind === 'account' ? 'download-help' : 'installer-unavailable'),
    close: async () => {
      click.mockRestore();
      await browser.happyDOM.close();
    },
  };
};

describe.each(['account', 'legacy'] as const)('%s stock installation setup', (kind) => {
  it('explains a missing stock download and keeps installed-only scripts behind a closed section', async () => {
    const f = await fixture(kind, false);
    try {
      expect(f.download.disabled).toBe(true);
      expect(f.unavailable.textContent).toContain('stock Codex installer is not available');
      expect(f.unavailable.closest('[hidden]')).toBeNull();
      expect(f.recovery.tagName).toBe('DETAILS');
      expect(f.recovery.hasAttribute('open')).toBe(false);
      expect(f.recovery.textContent).toContain('only after the team installer has completed');
      expect(f.element('app-server-start-command').textContent).toContain(
        'mate-7f2c1628-stock/bin/start.sh'
      );
      f.download.click();
      expect(f.requests).toEqual([]);
      expect(f.downloads).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it('downloads a generic stock bundle using its supported API contract and shows the actual installer command', async () => {
    const f = await fixture(kind, true);
    try {
      expect(f.download.disabled).toBe(false);
      expect(f.recovery.hasAttribute('open')).toBe(false);
      f.download.click();
      await vi.waitFor(() => expect(f.downloads).toHaveLength(1));
      expect(f.downloads[0]).toBe('agent-teams-join-7f2c1628-stock-darwin-arm64.sh');
      expect(f.requests[0]).toMatchObject({ runtime: 'stock' });
      expect(f.requests[0]).not.toHaveProperty('platform');
      const command = f.element(kind === 'account' ? 'install-command' : 'run-command');
      expect(command.textContent).toContain(
        'Downloads/agent-teams-join-7f2c1628-stock-darwin-arm64.sh'
      );
      expect(command.textContent).not.toContain('/bin/start.sh');
      if (kind === 'account') {
        expect(f.element('install-result').hasAttribute('hidden')).toBe(false);
        f.selectPlatform('linux-x64');
        expect(f.element('install-result').hasAttribute('hidden')).toBe(true);
      }
    } finally {
      await f.close();
    }
  });

  it('requires a Windows artifact rather than downloading a generic Unix script as PowerShell', async () => {
    const f = await fixture(kind, true);
    try {
      f.selectPlatform('win32-x64');
      expect(f.download.disabled).toBe(true);
      expect(f.unavailable.textContent).toContain('not available for this computer');
      f.download.click();
      expect(f.requests).toEqual([]);
    } finally {
      await f.close();
    }
  });
});
