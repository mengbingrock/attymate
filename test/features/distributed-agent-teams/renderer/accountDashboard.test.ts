// @vitest-environment node
import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';

import {
  ACCOUNT_PORTAL_JS,
  accountPortalHtml,
} from '../../../../packages/agent-teams-relay/src/accountPortal/accountAssets';

const base = 'https://relay.example/next';
const user = { id: 'u1', name: 'Test Owner', email: 'owner@example.test' };
const team = {
  teamId: '40000000-0000-4000-8000-000000000001',
  name: '<img src=x onerror=alert(1)>',
  description: 'Private research team',
  role: 'owner',
  coordination: 'leaderless',
  members: [{ ...user, role: 'owner' }],
  agents: [],
  devices: [],
  invites: [],
};
const browserFor = (url = base + '/join/') =>
  new Window({
    url,
    settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  });
const mount = (b: Window) => {
  b.document.write(accountPortalHtml(base));
  b.eval(ACCOUNT_PORTAL_JS);
  b.document.dispatchEvent(new b.Event('DOMContentLoaded'));
};

it('shows Google sign-in without persisting credentials in browser storage', async () => {
  const b = browserFor();
  b.fetch = vi.fn(
    async () =>
      new b.Response(
        JSON.stringify({ configured: true, user: null, csrf: null, installerPlatforms: [] })
      )
  ) as typeof b.fetch;
  try {
    mount(b);
    await vi.waitFor(() =>
      expect(b.document.getElementById('welcome')!.hasAttribute('hidden')).toBe(false)
    );
    expect(b.document.getElementById('google-sign-in')!.getAttribute('href')).toBe(
      '/next/join/auth/google'
    );
    expect(b.localStorage.length).toBe(0);
    expect(b.sessionStorage.length).toBe(0);
  } finally {
    await b.happyDOM.close();
  }
});

it('creates a private team, renders untrusted names safely, and generates a copyable invitation', async () => {
  const b = browserFor();
  let created = false;
  const writes: { path: string; body: unknown; csrf: unknown }[] = [];
  b.fetch = vi.fn(async (url, options) => {
    const path = String(url).split('api/account/')[1];
    let data: unknown;
    if (path === 'session')
      data = {
        configured: true,
        user,
        csrf: 'test-csrf',
        installerPlatforms: [{ id: 'darwin-x64', label: 'macOS · Intel' }],
      };
    else if (path === 'dashboard') data = { teams: created ? [team] : [], devices: [] };
    else if (path === 'teams') {
      created = true;
      writes.push({
        path,
        body: JSON.parse(String(options?.body)),
        csrf: (options?.headers as Record<string, string>)['x-csrf-token'],
      });
      data = { team };
    } else if (path.endsWith('/invites')) {
      writes.push({
        path,
        body: JSON.parse(String(options?.body)),
        csrf: (options?.headers as Record<string, string>)['x-csrf-token'],
      });
      data = { url: base + '/join/?invite=ati_test-fixture' };
    } else throw new Error('Unexpected API: ' + path);
    return new b.Response(JSON.stringify(data));
  }) as typeof b.fetch;
  try {
    mount(b);
    await vi.waitFor(() =>
      expect(b.document.getElementById('dashboard')!.hasAttribute('hidden')).toBe(false)
    );
    (b.document.getElementById('show-create') as unknown as HTMLButtonElement).click();
    (b.document.getElementById('team-name') as unknown as HTMLInputElement).value = team.name;
    (b.document.getElementById('team-description') as unknown as HTMLInputElement).value =
      team.description;
    b.document
      .getElementById('create-team')!
      .dispatchEvent(new b.Event('submit', { cancelable: true }));
    await vi.waitFor(() =>
      expect(b.document.getElementById('team-detail')!.hasAttribute('hidden')).toBe(false)
    );
    expect(b.document.getElementById('detail-name')!.textContent).toBe(team.name);
    expect(b.document.querySelector('#detail-name img')).toBeNull();
    expect(writes[0]).toMatchObject({
      path: 'teams',
      body: { name: team.name, description: team.description },
      csrf: 'test-csrf',
    });
    b.document
      .getElementById('create-invite')!
      .dispatchEvent(new b.Event('submit', { cancelable: true }));
    await vi.waitFor(() =>
      expect(b.document.getElementById('invite-result')!.hasAttribute('hidden')).toBe(false)
    );
    expect(
      (b.document.getElementById('invite-link') as unknown as HTMLInputElement).value
    ).toContain('?invite=');
    expect(b.document.getElementById('my-devices')!.textContent).toContain('after installation');
    expect(b.localStorage.length).toBe(0);
  } finally {
    await b.happyDOM.close();
  }
});

it('requires explicit acceptance before adding an invited member to the dashboard and showing setup', async () => {
  const b = browserFor(base + '/join/?invite=ati_fixture');
  let accepted = false;
  const member = { ...user, id: 'u2', name: 'Invited Member', email: 'member@example.test' };
  const joined = {
    ...team,
    role: 'member',
    members: [...team.members, { ...member, role: 'member' }],
  };
  b.fetch = vi.fn(async (url, options) => {
    const path = String(url).split('api/account/')[1];
    let data;
    if (path === 'session')
      data = { configured: true, user: member, csrf: 'csrf', installerPlatforms: [] };
    else if (path === 'invites/ati_fixture')
      data = { team, inviter: user.name, alreadyJoined: false, emailRestricted: false };
    else if (path === 'invites/ati_fixture/accept') {
      expect(options?.method).toBe('POST');
      accepted = true;
      data = { team: joined };
    } else if (path === 'dashboard') data = { teams: accepted ? [joined] : [], devices: [] };
    else throw new Error('Unexpected API ' + path);
    return new b.Response(JSON.stringify(data));
  }) as typeof b.fetch;
  try {
    mount(b);
    await vi.waitFor(() =>
      expect(b.document.getElementById('accept-invite')!.hasAttribute('hidden')).toBe(false)
    );
    expect(accepted).toBe(false);
    expect(b.document.getElementById('invite-account')!.textContent).toContain(member.email);
    (b.document.getElementById('accept-invite') as unknown as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(b.document.getElementById('team-detail')!.hasAttribute('hidden')).toBe(false)
    );
    expect(accepted).toBe(true);
    expect(b.document.getElementById('invite-controls')!.hasAttribute('hidden')).toBe(true);
    expect(b.document.getElementById('notice')!.textContent).toContain('saved in your dashboard');
    expect(b.document.querySelector('.setup-panel')!.textContent).toContain(
      'Choose your desktop chat'
    );
  } finally {
    await b.happyDOM.close();
  }
});

it.each(['darwin-x64', 'linux-x64', 'win32-x64'])(
  'downloads stock runtime and shows local server commands for %s',
  async (platform) => {
    const b = browserFor(base + '/join/?team=' + team.teamId);
    const writes: unknown[] = [];
    b.fetch = vi.fn(async (url, options) => {
      const path = String(url).split('api/account/')[1];
      if (path.endsWith('/installer')) {
        writes.push(JSON.parse(String(options?.body)));
        return new b.Response('stock worker');
      }
      const data =
        path === 'session'
          ? {
              configured: true,
              user,
              csrf: 'csrf',
              installerPlatforms: [{ id: 'linux-x64', label: 'Linux' }],
              installerRuntimes: [
                {
                  id: 'fork',
                  label: 'Use bundled team runtime',
                  installerPlatforms: [{ id: 'linux-x64', label: 'Linux' }],
                },
                {
                  id: 'stock',
                  label: 'Use installed Codex',
                  installerPlatforms: [{ id: platform, label: 'Selected computer' }],
                },
              ],
            }
          : path === 'dashboard'
            ? { teams: [team], devices: [] }
            : { team };
      return new b.Response(JSON.stringify(data));
    }) as typeof b.fetch;
    b.URL.createObjectURL = vi.fn(() => 'blob:test');
    b.URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(b.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      mount(b);
      await vi.waitFor(() =>
        expect(b.document.querySelectorAll('#runtime-buttons button')).toHaveLength(2)
      );
      const runtime = Array.from(b.document.querySelectorAll('#runtime-buttons button')).find(
        (button) => button.textContent === 'Use installed Codex'
      )!;
      (runtime as unknown as HTMLButtonElement).click();
      const computer = b.document.querySelectorAll('#platform-buttons button')[
        ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64'].indexOf(platform)
      ];
      (computer as unknown as HTMLButtonElement).click();
      expect(b.document.getElementById('app-server-start-command')!.closest('[hidden]')).toBeNull();
      expect(b.document.getElementById('desktop-launch-command')!.closest('[hidden]')).toBeNull();
      expect(b.document.getElementById('app-server-start-command')!.textContent).toContain(
        'mate-40000000-stock/bin/start.'
      );
      expect(writes).toEqual([]);
      expect(click).not.toHaveBeenCalled();
      (b.document.getElementById('device-label') as unknown as HTMLInputElement).value =
        'stock-mac';
      (b.document.getElementById('download-installer') as unknown as HTMLButtonElement).click();
      await vi.waitFor(() => expect(click).toHaveBeenCalled());
      expect(writes).toEqual([{ platform, runtime: 'stock', label: 'stock-mac' }]);
      await vi.waitFor(() =>
        expect(b.document.getElementById('desktop-launch-command')!.textContent).toContain(
          'mate-40000000-stock/bin/' +
            (platform.startsWith('linux-') ? 'attach.' : 'desktop.') +
            (platform === 'win32-x64' ? 'ps1' : 'sh')
        )
      );
      const windows = platform === 'win32-x64';
      for (const mode of ['start', 'status']) {
        expect(b.document.getElementById('app-server-' + mode + '-command')!.textContent).toBe(
          windows
            ? 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA/AgentTeams/mate-40000000-stock/bin/' +
                mode +
                '.ps1"'
            : 'bash "$HOME/.local/share/agent-teams/mate-40000000-stock/bin/' + mode + '.sh"'
        );
      }
      expect(b.document.getElementById('app-server-help')!.textContent).toContain(
        windows ? 'ws://127.0.0.1' : 'unix://'
      );
      expect(b.document.getElementById('app-server-help')!.textContent).toContain(
        'local relay on 127.0.0.1, which forwards team messages to the AWS relay'
      );
      expect(b.document.getElementById('install-command')!.textContent).toContain(
        '-stock-' + platform + (platform === 'win32-x64' ? '.ps1' : '.sh')
      );
    } finally {
      click.mockRestore();
      await b.happyDOM.close();
    }
  }
);

it('shows and copies local server instructions without any available installer', async () => {
  const b = browserFor(base + '/join/?team=' + team.teamId);
  const calls: string[] = [];
  b.fetch = vi.fn(async (url, options) => {
    const path = String(url).split('api/account/')[1];
    calls.push(path);
    expect(options?.method).toBe('GET');
    if (path === 'session')
      return new b.Response(
        JSON.stringify({
          configured: true,
          user,
          csrf: 'csrf',
          installerRuntimes: [],
          installerPlatforms: [],
        })
      );
    if (path === 'dashboard') return new b.Response(JSON.stringify({ teams: [team], devices: [] }));
    throw new Error('Unexpected API: ' + path);
  }) as typeof b.fetch;
  const clipboard = vi.spyOn(b.navigator.clipboard, 'writeText').mockResolvedValue();
  try {
    mount(b);
    await vi.waitFor(() =>
      expect(b.document.querySelectorAll('#platform-buttons button')).toHaveLength(5)
    );
    expect(b.document.getElementById('local-server-instructions')!.closest('[hidden]')).toBeNull();
    (
      b.document.querySelectorAll('#platform-buttons button')[1] as unknown as HTMLButtonElement
    ).click();
    const start = b.document.getElementById('app-server-start-command')!;
    expect(start.textContent).toBe(
      'bash "$HOME/.local/share/agent-teams/mate-40000000/bin/start.sh"'
    );
    expect(start.closest('[hidden]')).toBeNull();
    expect(
      (b.document.getElementById('download-installer') as unknown as HTMLButtonElement).disabled
    ).toBe(true);
    (b.document.getElementById('copy-app-server-start') as unknown as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(b.document.getElementById('notice')!.textContent).toBe(
        'Local server start command copied.'
      )
    );
    expect(clipboard).toHaveBeenCalledWith(start.textContent);
    (
      b.document.querySelectorAll('#runtime-buttons button')[1] as unknown as HTMLButtonElement
    ).click();
    expect(start.textContent).toContain('mate-40000000-stock/bin/start.sh');
    expect(calls.some((path) => path.endsWith('/installer'))).toBe(false);
  } finally {
    await b.happyDOM.close();
  }
});
