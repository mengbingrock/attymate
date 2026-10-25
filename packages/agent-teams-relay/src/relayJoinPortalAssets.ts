/**
 * Static assets of the public join portal, served from memory so the Relay stays a single bundle.
 * The page loads nothing from other origins and builds all dynamic content with textContent, never
 * innerHTML, because team names and descriptions come from Relay managers.
 */

export const JOIN_PORTAL_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Join a team · Agent Teams</title>
<link rel="stylesheet" href="app.css">
<script src="app.js" defer></script>
</head>
<body>
<header class="top">
  <div class="wrap top-row">
    <div class="brand"><span class="mark" aria-hidden="true"></span>Agent Teams</div>
    <span class="tag">Team directory</span>
  </div>
</header>
<main class="wrap">
  <section class="intro">
    <h1>Join a team</h1>
    <p>Pick a team, unlock it with the join token its owner gave you, and connect this computer as a member.
       Codex keeps running on your machine. The token admits you to that one team only.</p>
  </section>
  <div class="toolbar">
    <label class="search">
      <span class="visually-hidden">Filter teams</span>
      <input id="filter" type="search" placeholder="Filter teams" autocomplete="off" spellcheck="false">
    </label>
    <span id="count" class="muted"></span>
  </div>
  <p id="status" class="status" role="status" aria-live="polite">Loading teams…</p>
  <ul id="teams" class="teams"></ul>
</main>

<dialog id="join" aria-labelledby="join-title">
  <div class="sheet">
    <div class="sheet-head">
      <div>
        <p class="eyebrow">Join team</p>
        <h2 id="join-title"></h2>
      </div>
      <button type="button" class="icon-button" id="close" aria-label="Close">×</button>
    </div>

    <form id="unlock" class="unlock" novalidate>
      <label class="field">
        <span>Join token</span>
        <input id="token" type="password" autocomplete="off" spellcheck="false" placeholder="atj_…" required data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other">
        <small>Ask the team owner. It is checked by the relay and never stored in this page.</small>
      </label>
      <label class="field">
        <span>Your member name</span>
        <input id="label" type="text" autocomplete="off" spellcheck="false" maxlength="40" placeholder="e.g. alice-laptop" required data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other">
        <small>Letters, digits, dot, dash, or underscore. Teammates see this name.</small>
      </label>
      <p id="unlock-error" class="error" role="alert" hidden></p>
      <button id="unlock-button" type="submit" class="primary">Unlock</button>
    </form>

    <div id="unlocked" class="unlocked" hidden>
      <p class="success" role="status">Token accepted. Choose how to connect this computer.</p>

      <section class="option" id="option-installer">
        <h3><span class="step">1</span>One command</h3>
        <p class="muted">For macOS or Linux with the Codex CLI installed and signed in. It installs a background service that uses your existing Codex home.</p>
        <button id="download" type="button" class="primary">Download installer</button>
        <p id="download-error" class="error" role="alert" hidden></p>
        <p class="muted">Then run it:</p>
        <div class="code"><pre id="run-command"></pre><button type="button" class="copy" data-copy="run-command">Copy</button></div>
        <p class="warn">The installer contains your join token. Keep it to yourself.</p>
      </section>

      <section class="option" id="option-clone">
        <h3><span class="step">2</span>From a clone</h3>
        <p class="muted">Run the worker from source. Needs Node 24.15 or newer, pnpm, and the Codex CLI signed in.</p>
        <div class="code"><pre id="clone-commands"></pre><button type="button" class="copy" data-copy="clone-commands">Copy</button></div>
        <p class="muted">Keep it running in tmux or a login service. To restart later, rerun the last block.</p>
      </section>
    </div>
  </div>
</dialog>
</body>
</html>
`;

export const JOIN_PORTAL_CSS = String.raw`
:root {
  color-scheme: light dark;
  --bg: #f6f7f9;
  --surface: #ffffff;
  --surface-2: #f0f2f5;
  --text: #15181d;
  --muted: #5c6470;
  --border: #dde1e7;
  --accent: #2f6fde;
  --accent-text: #ffffff;
  --accent-soft: #e6eefc;
  --ok: #1d7a46;
  --ok-soft: #e3f4ea;
  --warn: #8a5a00;
  --danger: #b42318;
  --led: #8a5a00;
  --led-soft: #fbf0d9;
  --peer: #1f6f8b;
  --peer-soft: #dff1f7;
  --code-bg: #101418;
  --code-text: #e6e9ee;
  --radius: 10px;
  --shadow: 0 1px 2px rgba(16, 24, 40, .06), 0 8px 24px rgba(16, 24, 40, .06);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0e1116;
    --surface: #161a21;
    --surface-2: #1d222b;
    --text: #e8ebf0;
    --muted: #98a1ae;
    --border: #2a303b;
    --accent: #6a9cf2;
    --accent-text: #0b1020;
    --accent-soft: #1b2a45;
    --ok: #5fcf8e;
    --ok-soft: #14301f;
    --warn: #e0b45a;
    --danger: #f2877d;
    --led: #e0b45a;
    --led-soft: #33280f;
    --peer: #6cc4e0;
    --peer-soft: #12303a;
    --code-bg: #0a0d11;
    --shadow: none;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 880px; margin: 0 auto; padding: 0 16px; }
.top { border-bottom: 1px solid var(--border); background: var(--surface); }
.top-row { display: flex; align-items: center; justify-content: space-between; height: 56px; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 650; letter-spacing: -.01em; }
.mark { width: 22px; height: 22px; border-radius: 6px; background: linear-gradient(135deg, var(--accent), var(--peer)); }
.tag { font-size: 12px; color: var(--muted); border: 1px solid var(--border); border-radius: 999px; padding: 2px 10px; }
.intro { padding: 40px 0 8px; }
.intro h1 { font-size: 28px; line-height: 1.2; letter-spacing: -.02em; margin: 0 0 8px; }
.intro p { margin: 0; color: var(--muted); max-width: 62ch; }
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 24px 0 12px; }
.search { flex: 1; max-width: 360px; }
input {
  width: 100%;
  font: inherit;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 9px 12px;
}
input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.muted { color: var(--muted); }
.status { color: var(--muted); margin: 8px 0; }
.status.error-state { color: var(--danger); }
.teams { list-style: none; padding: 0; margin: 0 0 48px; display: grid; gap: 12px; }
.team {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 16px;
  align-items: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px 18px;
  box-shadow: var(--shadow);
}
.team h2 { font-size: 16px; margin: 0; letter-spacing: -.01em; }
.team p { margin: 0; color: var(--muted); grid-column: 1; overflow-wrap: anywhere; }
.team .meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; grid-column: 1; margin-top: 6px; font-size: 13px; color: var(--muted); }
.team .actions { grid-column: 2; grid-row: 1 / span 3; }
.badge { font-size: 12px; font-weight: 600; border-radius: 999px; padding: 2px 9px; }
.badge.leaderless { color: var(--peer); background: var(--peer-soft); }
.badge.led { color: var(--led); background: var(--led-soft); }
.dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--muted); margin-right: 5px; vertical-align: 1px; }
.dot.on { background: var(--ok); }
button { font: inherit; cursor: pointer; border-radius: 8px; }
.primary { background: var(--accent); color: var(--accent-text); border: 0; padding: 9px 16px; font-weight: 600; }
.primary:disabled { opacity: .6; cursor: progress; }
.secondary { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); padding: 8px 14px; font-weight: 600; }
.icon-button { background: transparent; border: 0; color: var(--muted); font-size: 24px; line-height: 1; padding: 4px 8px; }
dialog { border: 0; padding: 0; background: transparent; width: min(640px, calc(100vw - 32px)); max-height: calc(100vh - 32px); }
dialog::backdrop { background: rgba(8, 12, 18, .55); }
.sheet { background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 14px; padding: 20px; max-height: calc(100vh - 32px); overflow: auto; }
.sheet-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.sheet-head h2 { margin: 0; font-size: 20px; letter-spacing: -.01em; overflow-wrap: anywhere; }
.eyebrow { margin: 0 0 2px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.unlock { display: grid; gap: 14px; }
.field { display: grid; gap: 6px; }
.field > span { font-weight: 600; font-size: 14px; }
.field small { color: var(--muted); font-size: 12.5px; }
.error { color: var(--danger); margin: 0; }
.success { color: var(--ok); background: var(--ok-soft); border-radius: 8px; padding: 8px 12px; margin: 0 0 8px; }
.warn { color: var(--warn); font-size: 13px; margin: 8px 0 0; }
.option { border-top: 1px solid var(--border); padding-top: 16px; margin-top: 16px; }
.option h3 { display: flex; align-items: center; gap: 8px; font-size: 16px; margin: 0 0 4px; }
.option p { margin: 4px 0 10px; }
.step { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-size: 12px; font-weight: 700; }
.code { position: relative; }
pre {
  margin: 0;
  background: var(--code-bg);
  color: var(--code-text);
  border-radius: 8px;
  padding: 12px 70px 12px 12px;
  font: 12.5px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow-x: auto;
  white-space: pre;
}
.copy { position: absolute; top: 8px; right: 8px; background: rgba(255, 255, 255, .1); color: var(--code-text); border: 1px solid rgba(255, 255, 255, .18); font-size: 12px; padding: 3px 9px; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
[hidden] { display: none !important; }
@media (max-width: 560px) {
  .intro h1 { font-size: 24px; }
  .team { grid-template-columns: 1fr; }
  .team .actions { grid-column: 1; grid-row: auto; margin-top: 10px; }
  .toolbar { flex-direction: column; align-items: stretch; }
  .search { max-width: none; }
}
`;

export const JOIN_PORTAL_APP_JS = String.raw`
(function () {
  'use strict';
  var LABEL_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;
  var teams = [];
  var current = null; // { team, token, label, verified }

  function $(id) { return document.getElementById(id); }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function setStatus(text, isError) {
    var status = $('status');
    status.textContent = text;
    status.hidden = !text;
    status.classList.toggle('error-state', !!isError);
  }

  function renderTeams() {
    var list = $('teams');
    var query = $('filter').value.trim().toLowerCase();
    var shown = teams.filter(function (team) {
      return !query || (team.name + ' ' + team.description).toLowerCase().indexOf(query) !== -1;
    });
    list.replaceChildren();
    shown.forEach(function (team) {
      var item = el('li', 'team');
      item.appendChild(el('h2', '', team.name));
      if (team.description) item.appendChild(el('p', '', team.description));
      var meta = el('div', 'meta');
      var leaderless = team.coordination === 'leaderless';
      meta.appendChild(el('span', 'badge ' + (leaderless ? 'leaderless' : 'led'), leaderless ? 'Leaderless' : 'Led'));
      var presence = el('span');
      var dot = el('span', 'dot' + (team.online > 0 ? ' on' : ''));
      presence.appendChild(dot);
      presence.appendChild(document.createTextNode(team.online + ' of ' + team.members + ' member' + (team.members === 1 ? '' : 's') + ' online'));
      meta.appendChild(presence);
      item.appendChild(meta);
      var actions = el('div', 'actions');
      var button = el('button', 'secondary', 'Join');
      button.type = 'button';
      button.setAttribute('aria-label', 'Join ' + team.name);
      button.addEventListener('click', function () { openJoin(team); });
      actions.appendChild(button);
      item.appendChild(actions);
      list.appendChild(item);
    });
    $('count').textContent = teams.length ? shown.length + ' of ' + teams.length + ' team' + (teams.length === 1 ? '' : 's') : '';
    if (!teams.length) setStatus('No teams are open for joining on this relay yet.');
    else if (!shown.length) setStatus('No team matches that filter.');
    else setStatus('');
  }

  function loadTeams() {
    fetch('api/teams', { headers: { accept: 'application/json' }, cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (body) {
        teams = body.teams || [];
        renderTeams();
      })
      .catch(function () { setStatus('Could not load teams from the relay. Try again shortly.', true); });
  }

  function openJoin(team) {
    current = { team: team, token: '', label: '', verified: false };
    $('join-title').textContent = team.name;
    $('token').value = '';
    $('label').value = '';
    $('unlock').hidden = false;
    $('unlocked').hidden = true;
    showError('');
    $('join').showModal();
    $('token').focus();
  }

  function closeJoin() {
    current = null;
    $('token').value = '';
    $('join').close();
  }

  function showError(text) {
    var node = $('unlock-error');
    node.textContent = text;
    node.hidden = !text;
  }

  function postJson(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store'
    });
  }

  function describeFailure(response) {
    if (response.status === 401) return Promise.resolve('That token does not match this team.');
    if (response.status === 429) {
      return response.json().then(function (body) {
        var minutes = Math.max(1, Math.ceil((body.retryAfterSeconds || 60) / 60));
        return 'Too many attempts. Try again in about ' + minutes + ' minute' + (minutes === 1 ? '' : 's') + '.';
      }, function () { return 'Too many attempts. Try again later.'; });
    }
    return Promise.resolve('The relay could not check the token (HTTP ' + response.status + ').');
  }

  function unlock(event) {
    event.preventDefault();
    if (!current) return;
    var token = $('token').value.trim();
    var label = $('label').value.trim();
    if (!token) { showError('Enter the join token.'); $('token').focus(); return; }
    if (!LABEL_PATTERN.test(label)) {
      showError('Use 1-40 letters, digits, dots, dashes, or underscores for your member name.');
      $('label').focus();
      return;
    }
    showError('');
    var button = $('unlock-button');
    button.disabled = true;
    button.textContent = 'Checking…';
    postJson('api/teams/' + encodeURIComponent(current.team.teamId) + '/verify', { token: token })
      .then(function (response) {
        if (!response.ok) return describeFailure(response).then(function (message) { throw new Error(message); });
        return response.json();
      })
      .then(function (body) {
        current.token = token;
        current.label = label;
        current.verified = true;
        showUnlocked(body);
      })
      .catch(function (error) { showError(error.message); })
      .then(function () {
        button.disabled = false;
        button.textContent = 'Unlock';
      });
  }

  function cloneCommands(body) {
    var team8 = current.team.teamId.slice(0, 8);
    var repo = body.repository;
    return [
      '# 1. Get the worker (once)',
      'git clone -b ' + repo.branch + ' ' + repo.url + ' agent-teams && cd agent-teams',
      'pnpm install --filter "@claude-teams/agent-teams-worker..."',
      '',
      '# 2. Save the token and a fixed identity (once)',
      'D=~/.local/share/agent-teams/team-' + team8,
      'mkdir -p "$D/data" ~/agent-teams-workspace && chmod 700 "$D" ~/.codex',
      'cat > "$D/worker.env" <<EOF',
      'AGENT_TEAMS_RELAY_WORKER_TOKEN=' + current.token,
      'AGENT_TEAMS_AUTO_JOIN_TEAM_ID=' + current.team.teamId,
      'ORG=$(uuidgen)',
      'PERSON=$(uuidgen)',
      'NODE=$(uuidgen)',
      'INSTANCE=$(uuidgen)',
      'EOF',
      'chmod 600 "$D/worker.env"',
      '',
      '# 3. Start the worker (from the agent-teams folder; rerun to restart)',
      'D=~/.local/share/agent-teams/team-' + team8,
      'set -a; . "$D/worker.env"; set +a',
      'pnpm --filter @claude-teams/agent-teams-worker dev start \\',
      '  --relay ' + body.workerStreamUrl + ' \\',
      '  --label ' + current.label + ' \\',
      '  --data-dir "$D/data" --control-socket /tmp/agent-teams-' + team8 + '.sock \\',
      '  --codex-home ~/.codex --runtime-cwd ~/agent-teams-workspace \\',
      '  --organization-id "$ORG" --person-id "$PERSON" \\',
      '  --node-id "$NODE" --worker-instance-id "$INSTANCE"'
    ].join('\n');
  }

  function showUnlocked(body) {
    var team8 = current.team.teamId.slice(0, 8);
    $('unlock').hidden = true;
    $('unlocked').hidden = false;
    $('option-installer').hidden = !body.installerAvailable;
    $('run-command').textContent = 'bash ~/Downloads/agent-teams-join-' + team8 + '.sh --label ' + current.label;
    $('option-clone').hidden = !body.repository;
    if (body.repository) $('clone-commands').textContent = cloneCommands(body);
    $('token').value = '';
    ($('download').hidden ? $('close') : $('download')).focus();
  }

  function download() {
    if (!current || !current.verified) return;
    var button = $('download');
    button.disabled = true;
    button.textContent = 'Preparing…';
    var filename = 'agent-teams-join-' + current.team.teamId.slice(0, 8) + '.sh';
    $('download-error').hidden = true;
    postJson('api/teams/' + encodeURIComponent(current.team.teamId) + '/installer', { token: current.token })
      .then(function (response) {
        if (!response.ok) return describeFailure(response).then(function (message) { throw new Error(message); });
        return response.blob();
      })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var link = el('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
        button.textContent = 'Downloaded';
      })
      .catch(function (error) {
        button.textContent = 'Download installer';
        var node = $('download-error');
        node.textContent = error.message;
        node.hidden = false;
      })
      .then(function () {
        button.disabled = false;
        if (button.textContent === 'Preparing…') button.textContent = 'Download installer';
      });
  }

  function copyFrom(event) {
    var button = event.target.closest('.copy');
    if (!button) return;
    var text = $(button.getAttribute('data-copy')).textContent;
    var done = function () {
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = 'Copy'; }, 1500);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { button.textContent = 'Select and copy'; });
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('filter').addEventListener('input', renderTeams);
    $('unlock').addEventListener('submit', unlock);
    $('close').addEventListener('click', closeJoin);
    $('join').addEventListener('close', function () { current = null; });
    $('join').addEventListener('click', function (event) { if (event.target === $('join')) closeJoin(); });
    $('download').addEventListener('click', download);
    document.addEventListener('click', copyFrom);
    loadTeams();
  });
})();
`;
