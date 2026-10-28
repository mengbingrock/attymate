/* global process, console, setTimeout, URL, fetch */
// Native Windows installer/supervisor for isolated stock and fork installations.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import {
  existsSync,
  openSync,
  closeSync,
  linkSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  lstatSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [command, inputDir, ...extra] = process.argv.slice(2);
if (process.platform !== 'win32') throw new Error('This installer requires native Windows.');
const dir = resolve(inputDir);
const worker = join(dir, 'worker');
const self = fileURLToPath(import.meta.url);
const configPath = join(dir, 'config.json');
const psQuote = (value) => "'" + value.replaceAll("'", "''") + "'";
const powershell = (script) =>
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const run = (binary, args, env = process.env) => {
  const result = spawnSync(binary, args, { env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed: ${binary} (exit ${result.status})`);
};
const desktopExecutable = (config, explicit) => [
  explicit, config.desktopApp,
  join(process.env.LOCALAPPDATA, 'Programs', 'Codex', 'Codex.exe'),
  join(process.env.LOCALAPPDATA, 'Programs', 'ChatGPT', 'ChatGPT.exe'),
].filter(Boolean).find(existsSync);
const verify = (root) => {
  const manifest = JSON.parse(readFileSync(join(root, 'runtime-manifest.json'), 'utf8'));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.platform !== 'win32-x64' ||
    !manifest.revision ||
    !manifest.files?.['bin/codex.exe']
  )
    throw new Error('Invalid Windows runtime manifest');
  const seen = new Set();
  const visit = (path, prefix = '') => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const key = prefix + entry.name;
      const file = join(path, entry.name);
      if (entry.isDirectory()) visit(file, key + '/');
      else if (!entry.isFile() || lstatSync(file).isSymbolicLink())
        throw new Error('Unsafe runtime entry: ' + key);
      else if (key !== 'runtime-manifest.json') {
        if (createHash('sha256').update(readFileSync(file)).digest('hex') !== manifest.files[key])
          throw new Error('Runtime checksum mismatch: ' + key);
        seen.add(key);
      }
    }
  };
  visit(root);
  if (seen.size !== Object.keys(manifest.files).length) throw new Error('Incomplete runtime');
  console.log(`Verified customized Codex ${manifest.revision} for Windows x64`);
};

if (command === 'install') {
  for (const name of ['data', 'workspace', 'logs', 'bin', 'codex-state', 'desktop-data'])
    mkdirSync(join(dir, name), { recursive: true });
  if (existsSync(join(dir, 'data', 'supervisor.pid')))
    throw new Error('Stop this installation before replacing it.');
  const env = process.env;
  const runtimeKind = env.AGENT_TEAMS_INSTALL_RUNTIME || 'fork';
  if (!['stock', 'fork'].includes(runtimeKind)) throw new Error('Invalid runtime kind');
  if (
    existsSync(configPath) &&
    (JSON.parse(readFileSync(configPath, 'utf8')).runtimeKind || 'fork') !== runtimeKind
  )
    throw new Error(
      'Installation runtime differs; choose another directory to keep both installations.'
    );
  const serverOwnership = env.AGENT_TEAMS_INSTALL_SERVER_OWNERSHIP || 'managed';
  if (!['managed', 'external'].includes(serverOwnership))
    throw new Error('Invalid server ownership');
  let binary;
  if (runtimeKind === 'stock') {
    binary =
      env.AGENT_TEAMS_INSTALL_CODEX_BINARY ||
      powershell('(Get-Command codex.exe -ErrorAction Stop).Source').toString().trim();
    if (!binary || !existsSync(binary))
      throw new Error('Install official Codex or pass -CodexBinary with its executable path.');
    binary = resolve(binary);
    for (const [args, option] of [
      [['app-server', '--help'], '--listen'],
      [['agents', '--help'], '--remote'],
    ]) {
      const result = spawnSync(binary, args, { encoding: 'utf8', windowsHide: true });
      if (
        result.error ||
        result.status !== 0 ||
        !((result.stdout || '') + (result.stderr || '')).includes(option)
      )
        throw new Error('Selected stock Codex does not support ' + args.join(' ') + ' ' + option);
    }
  } else {
    if (env.AGENT_TEAMS_INSTALL_CODEX_BINARY)
      throw new Error('-CodexBinary is supported only for stock installers.');
    const runtime = join(worker, 'codex-runtime', 'win32-x64');
    verify(runtime);
    binary = join(runtime, 'bin', 'codex.exe');
  }
  let externalEndpoint;
  let externalToken;
  if (serverOwnership === 'external') {
    if (
      runtimeKind !== 'stock' ||
      !env.AGENT_TEAMS_INSTALL_CODEX_HOME ||
      !env.AGENT_TEAMS_INSTALL_APP_SERVER_TOKEN_FILE
    )
      throw new Error(
        'External mode requires stock runtime, -CodexHome, -AppServerSocket, and -AppServerTokenFile.'
      );
    externalEndpoint = env.AGENT_TEAMS_INSTALL_APP_SERVER_SOCKET;
    if (!/^ws:\/\/127\.0\.0\.1:[0-9]+$/.test(externalEndpoint || ''))
      throw new Error('External App Server must use an authenticated loopback WebSocket endpoint.');
    externalToken = readFileSync(env.AGENT_TEAMS_INSTALL_APP_SERVER_TOKEN_FILE, 'utf8').trim();
    if (!externalToken) throw new Error('External App Server capability token is empty.');
  } else if (
    env.AGENT_TEAMS_INSTALL_APP_SERVER_SOCKET ||
    env.AGENT_TEAMS_INSTALL_APP_SERVER_TOKEN_FILE
  ) {
    throw new Error('External endpoint options require -ServerOwnership external.');
  }
  const home = resolve(
    env.AGENT_TEAMS_INSTALL_CODEX_HOME ||
      (env.AGENT_TEAMS_INSTALL_PRIVATE_HOME === 'True'
        ? join(dir, 'codex-home')
        : env.CODEX_HOME || join(homedir(), '.codex'))
  );
  if (existsSync(home) && (!lstatSync(home).isDirectory() || lstatSync(home).isSymbolicLink()))
    throw new Error('Codex home must be a directory, not a link.');
  mkdirSync(home, { recursive: true });
  const loginEnv = { ...env, CODEX_HOME: home };
  if (spawnSync(binary, ['login', 'status'], { env: loginEnv, stdio: 'ignore' }).status !== 0) {
    if (runtimeKind === 'stock')
      throw new Error('No existing Codex login is available. Open Codex and sign in there, then rerun this installer. No new sign-in was started.');
    run(binary, ['login', '--device-auth'], loginEnv);
  }
  let config;
  if (existsSync(configPath)) config = JSON.parse(readFileSync(configPath, 'utf8'));
  else {
    if (
      !/^wss?:\/\//.test(env.AGENT_TEAMS_INSTALL_RELAY || '') ||
      !env.AGENT_TEAMS_INSTALL_TOKEN ||
      !/^[a-f0-9-]{36}$/.test(env.AGENT_TEAMS_INSTALL_TEAM || '')
    )
      throw new Error('Invalid enrollment');
    const id = randomBytes(12).toString('hex');
    config = {
      node: process.execPath,
      runtimeKind,
      serverOwnership,
      externalEndpoint,
      installationId: randomUUID(),
      binary,
      home,
      ...(env.AGENT_TEAMS_INSTALL_DESKTOP_APP ? { desktopApp: env.AGENT_TEAMS_INSTALL_DESKTOP_APP } : {}),
      relay: env.AGENT_TEAMS_INSTALL_RELAY,
      token: env.AGENT_TEAMS_INSTALL_TOKEN,
      team: env.AGENT_TEAMS_INSTALL_TEAM,
      label: env.AGENT_TEAMS_INSTALL_LABEL,
      organization: randomUUID(),
      person: randomUUID(),
      nodeId: randomUUID(),
      instance: randomUUID(),
      control: '\\\\.\\pipe\\agent-teams-' + id,
      serverToken: externalToken || randomBytes(32).toString('hex'),
    };
    config.controlMcpName = 'agent_teams_control_' + config.installationId.replaceAll('-', '');
    save(configPath, config);
  }
  for (const mode of ['start', 'stop', 'status', 'attach', 'desktop', 'uninstall']) {
    writeFileSync(
      join(dir, 'bin', mode + '.ps1'),
      '& ' +
        psQuote(process.execPath) +
        ' ' +
        psQuote(self) +
        ' ' +
        mode +
        ' ' +
        psQuote(dir) +
        ' @args\n'
    );
  }
  const setupControl = () =>
    run(process.execPath, [
      join(worker, 'cli.js'),
      'setup',
      '--data-dir',
      join(dir, 'data'),
      '--control-mcp-name',
      config.controlMcpName || 'agent-teams-control',
      '--control-socket',
      config.control,
      '--codex-config',
      join(home, 'config.toml'),
    ]);
  setupControl();
  if (env.AGENT_TEAMS_INSTALL_NO_SERVICE !== 'True') {
    const action =
      '& ' + psQuote(process.execPath) + ' ' + psQuote(self) + ' start ' + psQuote(dir);
    const startup = join(
      process.env.APPDATA,
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Startup',
      'AgentTeams-' + config.nodeId + '.lnk'
    );
    powershell(
      '$w=New-Object -ComObject WScript.Shell;$s=$w.CreateShortcut(' +
        psQuote(startup) +
        ');$s.TargetPath="powershell.exe";$s.Arguments=' +
        psQuote('-NoProfile -WindowStyle Hidden -Command ' + action) +
        ';$s.WindowStyle=7;$s.Save()'
    );
    console.log('Enabled this installation at user sign-in.');
  }
  console.log('Using existing Codex login at ' + home);
  if (env.AGENT_TEAMS_INSTALL_NO_START !== 'True') {
    run(process.execPath, [self, 'start', dir]);
    console.log('Waiting for the Worker to connect to its local relay on 127.0.0.1');
    console.log('AWS relay upstream: ' + config.relay);
    let connected = false;
    for (let i = 0; i < 300; i++) {
      try {
        const status = JSON.parse(readFileSync(join(dir, 'data', 'worker-status.json'), 'utf8'));
        if (status.state === 'connected') {
          console.log('Worker connected to ' + status.relayUrl + '; the local relay forwards team traffic to AWS.');
          connected = true;
          break;
        }
      } catch {
        /* waiting for first status */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!connected) throw new Error('Worker did not connect; see logs/supervisor.log');
    setupControl(); // The live Worker has now persisted metadata for expected-target removal.
    console.log(
      'Connected. Private device pairing code: ' +
        readFileSync(join(dir, 'data', 'desktop-pairing-code'), 'utf8').trim()
    );
  }
  console.log(
    'Installed. Open PowerShell and run: & ' +
      psQuote(join(dir, 'bin', 'desktop.ps1'))
  );
  if (env.AGENT_TEAMS_INSTALL_NO_START !== 'True' && env.AGENT_TEAMS_INSTALL_NO_DESKTOP !== 'True') {
    if (desktopExecutable(config)) {
      const log = openSync(join(dir, 'logs', 'desktop.log'), 'a');
      try {
        const app = spawn(process.execPath, [self, 'desktop', dir], {
          env, detached: true, windowsHide: true, stdio: ['ignore', log, log],
        });
        app.unref();
        console.log('Opening Codex desktop with your existing login.');
      } finally { closeSync(log); }
    } else console.log('Install Codex desktop, then run bin/desktop.ps1 to open it.');
  }
  process.exit(0);
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
// Reuse the selected login home directly; credentials are never copied between homes.
const pidFile = join(dir, 'data', 'supervisor.pid');
const endpointPath = join(dir, 'data', 'app-server.json');
const statusPath = join(dir, 'data', 'worker-status.json');
// Publish complete files exclusively; interrupted writes leave only private temporaries.
const publishLockFile = (path, content) => {
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
    try {
      linkSync(temporary, path);
      return true;
    } catch (error) {
      if (error.code === 'EEXIST') return false;
      throw error;
    }
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // A private temporary never controls ownership; recovery can ignore it.
    }
  }
};
// Immutable generations recover dead reclaimers without unlinking another guard.
// Do not delete this journal while the installation may be running.
const withLockReclamation = (file, operation) => {
  const directory = file + '.reclaims';
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid lock journal');
  while (true) {
    const latest = readdirSync(directory)
      .filter((name) => /^\d{16}\.json$/.test(name))
      .sort()
      .at(-1);
    let generation = 1;
    if (latest) {
      const previous = join(directory, latest);
      const owner = JSON.parse(readFileSync(previous, 'utf8'));
      if (
        !owner ||
        !Number.isSafeInteger(owner.pid) ||
        owner.pid < 1 ||
        typeof owner.token !== 'string' ||
        !owner.token
      )
        throw new Error('Invalid lock journal identity');
      let completed = false;
      try {
        completed = readFileSync(previous + '.done', 'utf8') === owner.token;
        if (!completed) throw new Error('Invalid lock journal completion');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (!completed) {
        try {
          process.kill(owner.pid, 0);
          return false;
        } catch (error) {
          if (error.code === 'EPERM') return false;
          if (error.code !== 'ESRCH') throw error;
        }
      }
      generation = Number(latest.slice(0, 16)) + 1;
      if (!Number.isSafeInteger(generation)) throw new Error('Lock journal exhausted');
    }
    const record = join(directory, String(generation).padStart(16, '0') + '.json');
    const token = randomUUID();
    if (!publishLockFile(record, JSON.stringify({ pid: process.pid, token }))) continue;
    try {
      operation();
    } finally {
      publishLockFile(record + '.done', token);
    }
    return true;
  }
};
const ownership = () => {
  try {
    const stat = lstatSync(pidFile);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid supervisor lock file.');
    const content = readFileSync(pidFile, 'utf8');
    if (!content.trim())
      throw new Error('Incomplete supervisor lock; inspect it before restarting.');
    let parsed;
    try {
      parsed = /^\s*[0-9]+\s*$/.test(content) ? { pid: Number(content) } : JSON.parse(content);
    } catch {
      throw new Error('Invalid supervisor lock; inspect it before restarting.');
    }
    if (
      !parsed ||
      !Number.isSafeInteger(parsed.pid) ||
      parsed.pid <= 1 ||
      (parsed.token !== undefined && typeof parsed.token !== 'string')
    )
      throw new Error('Invalid supervisor lock identity.');
    return { ...parsed, content, inode: stat.ino, device: stat.dev };
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
};
const removeIfOwned = (owner, guarded = false) => {
  if (!owner) return;
  const remove = () => {
    const current = ownership();
    if (
      current?.content !== owner.content ||
      current.inode !== owner.inode ||
      current.device !== owner.device
    )
      return;
    for (const path of [endpointPath, pidFile]) {
      try {
        unlinkSync(path);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  };
  if (guarded) remove();
  else withLockReclamation(pidFile, remove);
};
const acquireSupervisor = () => {
  const value = { pid: process.pid, token: randomUUID() };
  const content = JSON.stringify(value);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (publishLockFile(pidFile, content)) return ownership();
    if (
      !withLockReclamation(pidFile, () => {
        const previous = ownership();
        if (!previous) return;
        try {
          process.kill(previous.pid, 0);
          throw new Error(
            'This installation is already running or its PID belongs to another live process.'
          );
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
        removeIfOwned(previous, true);
      })
    )
      throw new Error(
        'Supervisor lock recovery is already in progress; retry after checking its owner.'
      );
  }
  throw new Error('Supervisor lock was claimed concurrently; retry after checking its owner.');
};
const alive = () => {
  const owner = ownership();
  if (!owner) return undefined;
  try {
    process.kill(owner.pid, 0);
    return owner.pid;
  } catch (error) {
    if (error.code === 'ESRCH') return undefined;
    throw error;
  }
};
const childEnv = {
  ...process.env,
  CODEX_HOME: config.home,
  AGENT_TEAMS_APP_SERVER_TOKEN: config.serverToken,
  AGENT_TEAMS_RELAY_WORKER_TOKEN: config.token,
  AGENT_TEAMS_AUTO_JOIN_TEAM_ID: config.team,
};
const endpoint = () => JSON.parse(readFileSync(endpointPath, 'utf8')).url;
if (command === 'start') {
  if (alive()) throw new Error('This installation is already running.');
  const log = openSync(join(dir, 'logs', 'supervisor.log'), 'a');
  const child = spawn(process.execPath, [self, 'run', dir], {
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
    env: childEnv,
  });
  let childError;
  child.on('error', (error) => {
    childError = error;
  });
  child.unref();
  closeSync(log);
  for (let i = 0; i < 200; i++) {
    const current = ownership();
    let published;
    try {
      published = JSON.parse(readFileSync(endpointPath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    if (
      current?.pid === child.pid &&
      published?.supervisorPid === child.pid &&
      published?.supervisorToken === current.token &&
      alive() === child.pid
    ) {
      console.log('Selected App Server started.');
      process.exit(0);
    }
    if (childError) throw childError;
    if (child.exitCode !== null && child.exitCode !== undefined)
      throw new Error('Supervisor failed to start; inspect logs/supervisor.log');
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Startup timed out; see logs/supervisor.log');
} else if (command === 'run') {
  const owner = acquireSupervisor();
  const children = [];
  const cleanup = () => {
    for (const child of children) {
      try {
        child.kill();
      } catch {
        /* exited */
      }
    }
    removeIfOwned(owner);
  };
  process.on('exit', cleanup);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));
  for (const path of [endpointPath, statusPath]) {
    try {
      unlinkSync(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  let url = config.externalEndpoint;
  let port;
  if (config.serverOwnership !== 'external') {
    const reservation = createServer();
    await new Promise((r) => reservation.listen(0, '127.0.0.1', r));
    port = reservation.address().port;
    await new Promise((r) => reservation.close(r));
    url = 'ws://127.0.0.1:' + port;
    const tokenPath = join(dir, 'data', 'app-server-token');
    writeFileSync(tokenPath, config.serverToken);
    const state = 'sqlite_home=' + JSON.stringify(join(dir, 'codex-state'));
    const serverLog = openSync(join(dir, 'logs', 'app-server.log'), 'a');
    const server = spawn(
      config.binary,
      [
        '-c',
        state,
        'app-server',
        '--listen',
        url,
        '--ws-auth',
        'capability-token',
        '--ws-token-file',
        tokenPath,
      ],
      { env: childEnv, windowsHide: true, stdio: ['ignore', serverLog, serverLog] }
    );
    closeSync(serverLog);
    children.push(server);
    server.on('error', (e) => {
      console.error(e);
      process.exit(1);
    });
    server.on('exit', () => process.exit(1));
  } else {
    port = new URL(url).port;
  }
  let ready = false;
  for (let i = 0; i < 300; i++) {
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/readyz');
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw new Error('Selected App Server did not become ready.');
  const workerProcess = spawn(
    process.execPath,
    [
      join(worker, 'localWorkerCli.js'),
      'start',
      '--app-server-mode',
      'shared-daemon',
      '--app-server-connect-only',
      '--app-server-socket',
      url,
      '--relay',
      config.relay,
      '--data-dir',
      join(dir, 'data'),
      '--control-socket',
      config.control,
      '--codex-home',
      config.home,
      '--runtime-cwd',
      join(dir, 'workspace'),
      '--codex-binary',
      config.binary,
      '--runtime-kind',
      config.runtimeKind || 'fork',
      '--server-ownership',
      config.serverOwnership || 'managed',
      ...(config.installationId ? ['--installation-id', config.installationId] : []),
      '--control-mcp-name',
      config.controlMcpName || 'agent-teams-control',
      '--label',
      config.label,
      '--organization-id',
      config.organization,
      '--person-id',
      config.person,
      '--node-id',
      config.nodeId,
      '--worker-instance-id',
      config.instance,
    ],
    { env: childEnv, windowsHide: true, stdio: 'inherit' }
  );
  children.push(workerProcess);
  workerProcess.on('error', (e) => {
    console.error(e);
    process.exit(1);
  });
  workerProcess.on('exit', () => process.exit(1));
  save(endpointPath, { url, supervisorPid: owner.pid, supervisorToken: owner.token });
} else if (command === 'stop' || command === 'uninstall') {
  const owner = ownership();
  const pid = alive();
  if (pid) {
    const info = JSON.parse(
      powershell(
        '(Get-CimInstance Win32_Process -Filter ' +
          psQuote('ProcessId=' + pid) +
          ').CommandLine | ConvertTo-Json'
      ).toString()
    );
    if (!info || !info.includes(self) || !info.includes(dir))
      throw new Error('PID does not belong to this installation.');
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'inherit' });
  }
  removeIfOwned(owner);
  if (command === 'uninstall') {
    run(process.execPath, [
      join(worker, 'cli.js'),
      'mcp-remove',
      '--control-socket',
      config.control,
      '--data-dir',
      join(dir, 'data'),
      '--control-mcp-name',
      config.controlMcpName || 'agent-teams-control',
      '--codex-config',
      join(config.home, 'config.toml'),
    ]);
    const shortcut = join(
      process.env.APPDATA,
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Startup',
      'AgentTeams-' + config.nodeId + '.lnk'
    );
    if (existsSync(shortcut)) unlinkSync(shortcut);
    console.log(
      'Owned MCP registration and startup shortcut removed. Runtime data and login retained.'
    );
  }
} else if (command === 'status') {
  console.log(JSON.stringify({ running: !!alive(), nodeId: config.nodeId }));
  if (existsSync(join(dir, 'data', 'worker-status.json')))
    console.log(readFileSync(join(dir, 'data', 'worker-status.json'), 'utf8'));
} else if (command === 'attach') {
  run(
    config.binary,
    [
      '--remote',
      endpoint(),
      '--remote-auth-token-env',
      'AGENT_TEAMS_APP_SERVER_TOKEN',
      'agents',
      ...extra,
    ],
    childEnv
  );
} else if (command === 'desktop') {
  const executable = desktopExecutable(config, extra[0]);
  if (!executable)
    throw new Error('Pass your installed Codex desktop .exe path as the first argument.');
  run(
    process.execPath,
    [
      join(worker, 'desktopBridgeCli.js'),
      endpoint(),
      config.control,
      config.home,
      join(dir, 'desktop-data'),
      executable,
      '--user-data-dir=' + join(dir, 'desktop-data'),
    ],
    childEnv
  );
} else throw new Error('Unknown installation command: ' + command);
