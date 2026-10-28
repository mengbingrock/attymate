// @vitest-environment node
import { Window } from 'happy-dom';

import {
  JOIN_PORTAL_APP_JS,
  JOIN_PORTAL_HTML,
} from '../../../../packages/agent-teams-relay/src/relayJoinPortalAssets';

it('pairs a device, opens its team chat, and saves a default without persisting the pairing secret', async () => {
  const browser = new Window({
    url: 'https://relay.example/next/join/',
    settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  });
  const requests: {
    request: { action: string; requestId: string; teamId?: string };
    pairingCode: string;
  }[] = [];
  const teamId = '40000000-0000-4000-8000-000000000001';
  let defaultTeamId: string | null = null;
  browser.fetch = vi.fn(async (url, options) => {
    if (String(url).endsWith('api/teams'))
      return new browser.Response(JSON.stringify({ teams: [] }));
    const body = JSON.parse(String(options?.body));
    requests.push(body);
    if (body.request.action === 'default') defaultTeamId = body.request.teamId;
    return new browser.Response(
      JSON.stringify({
        device: { label: 'Test Mac' },
        teams: [{ teamId, name: 'Test team', role: 'member' }],
        result: { defaultTeamId, chats: [], desktopOpened: body.request.action === 'open' },
      })
    );
  }) as typeof browser.fetch;
  try {
    browser.document.write(JOIN_PORTAL_HTML);
    browser.eval(JOIN_PORTAL_APP_JS);
    browser.document.dispatchEvent(new browser.Event('DOMContentLoaded'));
    const code = browser.document.getElementById('desktop-code') as unknown as HTMLInputElement;
    code.value = 'test-pairing-code';
    browser.document
      .getElementById('desktop-pair')!
      .dispatchEvent(new browser.Event('submit', { cancelable: true }));
    await vi.waitFor(() =>
      expect(browser.document.getElementById('desktop-status')!.textContent).toContain(
        'Test Mac: Connected'
      )
    );
    expect(code.value).toBe('');
    expect(browser.localStorage.length).toBe(0);
    const button = (text: string) =>
      Array.from(browser.document.querySelectorAll('button')).find((b) => b.textContent === text)!;
    button('Open team chat').click();
    await vi.waitFor(() =>
      expect(browser.document.getElementById('desktop-status')!.textContent).toContain(
        'Team chat opened'
      )
    );
    button('Use for new desktop chats').click();
    await vi.waitFor(() =>
      expect(browser.document.getElementById('desktop-teams')!.textContent).toContain(
        'Default for new chats'
      )
    );
    expect(requests.map((r) => r.request.action)).toEqual(['context', 'open', 'default']);
    expect(requests.every((r) => r.pairingCode === 'test-pairing-code')).toBe(true);
  } finally {
    await browser.happyDOM.close();
  }
});

it('shows member names, roles, and live presence, safely refreshes, and filters by member name', async () => {
  const browser = new Window({
    url: 'https://relay.example/next/join/',
    settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  });
  const team = {
    teamId: '40000000-0000-4000-8000-000000000001',
    name: 'Test team',
    description: '',
    coordination: 'leaderless',
    members: 2,
    online: 1,
    memberList: [
      { label: '<img src=x onerror=alert(1)>', role: 'lead', online: false },
      { label: 'pro3', role: 'member', online: true },
    ],
  };
  let fail = false;
  browser.fetch = vi.fn(async () => {
    if (fail) throw new Error('offline');
    return new browser.Response(JSON.stringify({ teams: [team] }));
  }) as typeof browser.fetch;
  const interval = vi.spyOn(browser, 'setInterval');
  try {
    browser.document.write(JOIN_PORTAL_HTML);
    browser.eval(JOIN_PORTAL_APP_JS);
    browser.document.dispatchEvent(new browser.Event('DOMContentLoaded'));
    await vi.waitFor(() => expect(browser.document.querySelectorAll('.member')).toHaveLength(2));
    expect(browser.document.querySelector('.member-name')!.textContent).toBe(
      team.memberList[0].label
    );
    expect(browser.document.querySelector('.roster img')).toBeNull();
    expect(browser.document.querySelector('.member-role')!.textContent).toBe('Lead');
    expect(browser.document.querySelectorAll('.member-status')[0].textContent).toBe('Offline');
    expect(browser.document.querySelectorAll('.member-status')[1].textContent).toBe('Online');
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 10000);

    const refresh = browser.document.getElementById('refresh') as unknown as HTMLButtonElement;
    fail = true;
    refresh.click();
    await vi.waitFor(() =>
      expect(browser.document.getElementById('status')!.textContent).toContain('out of date')
    );
    expect(browser.document.querySelectorAll('.member')).toHaveLength(2);
    await vi.waitFor(() => expect(refresh.disabled).toBe(false));

    fail = false;
    team.memberList[1].online = false;
    team.online = 0;
    refresh.click();
    await vi.waitFor(() =>
      expect(browser.document.querySelectorAll('.member-status')[1].textContent).toBe('Offline')
    );
    expect(browser.document.querySelector('.meta')!.textContent).toContain('0 of 2 members online');
    expect(browser.document.getElementById('status')!.textContent).toBe('');

    const filter = browser.document.getElementById('filter') as unknown as HTMLInputElement;
    filter.value = 'pro3';
    browser.document.getElementById('filter')!.dispatchEvent(new browser.Event('input'));
    expect(browser.document.querySelectorAll('.team')).toHaveLength(1);
    filter.value = 'not-a-member';
    browser.document.getElementById('filter')!.dispatchEvent(new browser.Event('input'));
    expect(browser.document.querySelectorAll('.team')).toHaveLength(0);
    filter.value = '';
    browser.document.getElementById('filter')!.dispatchEvent(new browser.Event('input'));

    team.memberList = [];
    team.members = 0;
    await vi.waitFor(() => expect(refresh.disabled).toBe(false));
    refresh.click();
    await vi.waitFor(() =>
      expect(browser.document.querySelector('.roster')!.textContent).toContain(
        'No members have joined yet.'
      )
    );
  } finally {
    await browser.happyDOM.close();
  }
});

it.each(['darwin-x64', 'linux-x64', 'win32-x64'])(
  'downloads the selected native build and shows its local commands (%s)',
  async (selectedPlatform) => {
    const browser = new Window({
      url: 'https://relay.example/next/join/',
      settings: {
        disableJavaScriptFileLoading: true,
        disableCSSFileLoading: true,
      },
    });
    const team = {
      teamId: '40000000-0000-4000-8000-000000000001',
      name: 'Test team',
      description: '',
      coordination: 'led',
      members: 0,
      online: 0,
    };
    const platforms = [
      { id: 'darwin-x64', label: 'macOS · Intel' },
      { id: 'linux-x64', label: 'Linux · Intel / AMD x64' },
      { id: 'win32-x64', label: 'Windows · x64' },
    ];
    const requests: Array<{ path: string; body: unknown }> = [];
    browser.fetch = vi.fn(async (input, options) => {
      const path = String(input);
      const body = options?.body ? JSON.parse(String(options.body)) : undefined;
      requests.push({ path, body });
      if (path.endsWith('/installer')) return new browser.Response('test installer');
      return new browser.Response(
        JSON.stringify(
          path.endsWith('/verify')
            ? { team, installerAvailable: true, installerPlatforms: platforms }
            : { teams: [team] }
        ),
        { headers: { 'content-type': 'application/json' } }
      );
    }) as typeof browser.fetch;
    browser.URL.createObjectURL = vi.fn(() => 'blob:test');
    browser.URL.revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(browser.HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    try {
      browser.document.write(JOIN_PORTAL_HTML);
      browser.eval(JOIN_PORTAL_APP_JS);
      browser.document.dispatchEvent(new browser.Event('DOMContentLoaded'));
      await vi.waitFor(() =>
        expect(browser.document.querySelector('#teams button')).not.toBeNull()
      );
      (browser.document.querySelector('#teams button') as unknown as HTMLButtonElement).click();
      const input = (id: string) =>
        browser.document.getElementById(id) as unknown as HTMLInputElement;
      input('token').value = 'atj_test-only';
      input('label').value = 'test-mac';
      browser.document
        .getElementById('unlock')!
        .dispatchEvent(new browser.Event('submit', { cancelable: true }));
      const button = browser.document.getElementById('download') as unknown as HTMLButtonElement;
      await vi.waitFor(() =>
        expect(browser.document.getElementById('unlocked')!.hasAttribute('hidden')).toBe(false)
      );
      expect(button.disabled).toBe(true);
      const platform = browser.document.getElementById('platform') as unknown as HTMLSelectElement;
      expect(Array.from(platform.options).map((option) => option.value)).toEqual([
        '',
        'darwin-arm64',
        'darwin-x64',
        'linux-arm64',
        'linux-x64',
        'win32-x64',
      ]);
      platform.value = selectedPlatform;
      browser.document.getElementById('platform')!.dispatchEvent(new browser.Event('change'));
      expect(button.disabled).toBe(false);
      expect(browser.document.getElementById('desktop-option')!.hasAttribute('hidden')).toBe(
        selectedPlatform !== 'darwin-x64'
      );
      expect(browser.document.getElementById('desktop-command')!.textContent).toContain(
        'mate-40000000/bin/desktop.sh'
      );
      expect(browser.document.getElementById('run-command')!.textContent).toContain(
        selectedPlatform === 'win32-x64'
          ? "agent-teams-join-40000000-win32-x64.ps1\" -Label 'test-mac'"
          : 'agent-teams-join-40000000-' + selectedPlatform + '.sh --label "test-mac"'
      );
      expect(browser.document.getElementById('attach-command')!.textContent).toContain(
        'mate-40000000/bin/attach.' + (selectedPlatform === 'win32-x64' ? 'ps1' : 'sh')
      );
      expect(
        browser.document.getElementById('app-server-start-command')!.closest('[hidden]')
      ).toBeNull();
      expect(requests.some((request) => request.path.endsWith('/installer'))).toBe(false);
      const windows = selectedPlatform === 'win32-x64';
      for (const mode of ['start', 'status']) {
        const command = browser.document.getElementById(
          'app-server-' + mode + '-command'
        )!.textContent;
        expect(command).toBe(
          windows
            ? '& "$env:LOCALAPPDATA/AgentTeams/mate-40000000/bin/' + mode + '.ps1"'
            : 'bash "$HOME/.local/share/agent-teams/mate-40000000/bin/' + mode + '.sh"'
        );
        expect(command).not.toContain('wss://');
      }
      expect(browser.document.getElementById('app-server-help')!.textContent).toContain(
        windows ? 'ws://127.0.0.1' : 'unix://'
      );
      expect(browser.document.getElementById('app-server-help')!.textContent).toContain(
        'local relay on 127.0.0.1, which forwards team messages to the AWS relay'
      );
      button.click();
      await vi.waitFor(() => expect(click).toHaveBeenCalled());
      expect(requests.find((request) => request.path.endsWith('/installer'))!.body).toEqual({
        token: 'atj_test-only',
        platform: selectedPlatform,
      });
    } finally {
      await browser.happyDOM.close();
      click.mockRestore();
    }
  }
);

it('selects stock artifacts independently and offers the desktop with the existing login', async () => {
  const browser = new Window({
    url: 'https://relay.example/next/join/',
    settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  });
  const team = {
    teamId: '40000000-0000-4000-8000-000000000001',
    name: 'Mixed team',
    members: 0,
    online: 0,
  };
  const requests: unknown[] = [];
  browser.fetch = vi.fn(async (input, options) => {
    const path = String(input);
    if (path.endsWith('/installer')) {
      requests.push(JSON.parse(String(options?.body)));
      return new browser.Response('stock installer');
    }
    const stock = [{ id: 'darwin-x64', label: 'macOS Intel' }];
    return new browser.Response(
      JSON.stringify(
        path.endsWith('/verify')
          ? {
              team,
              installerAvailable: true,
              installerPlatforms: [{ id: 'linux-x64', label: 'Linux' }],
              installerRuntimes: [
                {
                  id: 'fork',
                  label: 'Use bundled team runtime',
                  installerPlatforms: [{ id: 'linux-x64', label: 'Linux' }],
                },
                { id: 'stock', label: 'Use installed Codex', installerPlatforms: stock },
              ],
            }
          : { teams: [team] }
      )
    );
  }) as typeof browser.fetch;
  browser.URL.createObjectURL = vi.fn(() => 'blob:test');
  browser.URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(browser.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    browser.document.write(JOIN_PORTAL_HTML);
    browser.eval(JOIN_PORTAL_APP_JS);
    browser.document.dispatchEvent(new browser.Event('DOMContentLoaded'));
    await vi.waitFor(() => expect(browser.document.querySelector('#teams button')).not.toBeNull());
    (browser.document.querySelector('#teams button') as unknown as HTMLButtonElement).click();
    (browser.document.getElementById('token') as unknown as HTMLInputElement).value =
      'atj_test-only';
    (browser.document.getElementById('label') as unknown as HTMLInputElement).value = 'test-mac';
    browser.document
      .getElementById('unlock')!
      .dispatchEvent(new browser.Event('submit', { cancelable: true }));
    await vi.waitFor(() =>
      expect(browser.document.getElementById('runtime-field')!.hasAttribute('hidden')).toBe(false)
    );
    const runtime = browser.document.getElementById('runtime') as unknown as HTMLSelectElement;
    expect(runtime.value).toBe('fork');
    expect(browser.document.getElementById('app-server-start-command')!.textContent).toContain(
      'mate-40000000/bin/start.sh'
    );
    runtime.value = 'stock';
    browser.document.getElementById('runtime')!.dispatchEvent(new browser.Event('change'));
    expect(
      (browser.document.getElementById('platform') as unknown as HTMLSelectElement).value
    ).toBe('darwin-x64');
    expect(browser.document.getElementById('desktop-option')!.hasAttribute('hidden')).toBe(false);
    expect(browser.document.getElementById('desktop-command')!.textContent).toContain(
      'mate-40000000-stock/bin/desktop.sh'
    );
    expect(browser.document.getElementById('attach-command')!.textContent).toContain(
      'mate-40000000-stock/bin/attach.sh'
    );
    expect(browser.document.getElementById('run-command')!.textContent).toContain(
      '-stock-darwin-x64.sh'
    );
    (browser.document.getElementById('download') as unknown as HTMLButtonElement).click();
    await vi.waitFor(() => expect(click).toHaveBeenCalled());
    expect(requests).toEqual([
      { token: 'atj_test-only', platform: 'darwin-x64', runtime: 'stock' },
    ]);
  } finally {
    click.mockRestore();
    await browser.happyDOM.close();
  }
});

it('shows local instructions after unlock even when no downloads are available', async () => {
  const browser = new Window({
    url: 'https://relay.example/next/join/',
    settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  });
  const team = {
    teamId: '40000000-0000-4000-8000-000000000001',
    name: 'Test team',
    members: 0,
    online: 0,
  };
  browser.fetch = vi.fn(
    async (input) =>
      new browser.Response(
        JSON.stringify(
          String(input).endsWith('/verify')
            ? { team, installerAvailable: false, installerRuntimes: [] }
            : { teams: [team] }
        )
      )
  ) as typeof browser.fetch;
  try {
    browser.document.write(JOIN_PORTAL_HTML);
    browser.eval(JOIN_PORTAL_APP_JS);
    browser.document.dispatchEvent(new browser.Event('DOMContentLoaded'));
    await vi.waitFor(() => expect(browser.document.querySelector('#teams button')).not.toBeNull());
    (browser.document.querySelector('#teams button') as unknown as HTMLButtonElement).click();
    (browser.document.getElementById('token') as unknown as HTMLInputElement).value =
      'atj_test-only';
    (browser.document.getElementById('label') as unknown as HTMLInputElement).value = 'test-mac';
    browser.document
      .getElementById('unlock')!
      .dispatchEvent(new browser.Event('submit', { cancelable: true }));
    await vi.waitFor(() =>
      expect(browser.document.getElementById('unlocked')!.hasAttribute('hidden')).toBe(false)
    );
    const platform = browser.document.getElementById('platform') as unknown as HTMLSelectElement;
    expect(platform.closest('[hidden]')).toBeNull();
    platform.value = 'win32-x64';
    browser.document.getElementById('platform')!.dispatchEvent(new browser.Event('change'));
    const start = browser.document.getElementById('app-server-start-command')!;
    expect(start.closest('[hidden]')).toBeNull();
    expect(start.textContent).toContain('mate-40000000/bin/start.ps1');
    expect(browser.document.getElementById('app-server-help')!.textContent).toContain(
      'ws://127.0.0.1'
    );
    expect(browser.document.getElementById('option-installer')!.hasAttribute('hidden')).toBe(true);
    expect(browser.fetch).toHaveBeenCalledTimes(2);
  } finally {
    await browser.happyDOM.close();
  }
});
