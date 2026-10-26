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
