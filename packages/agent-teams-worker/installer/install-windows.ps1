param(
  [string]$Label = $env:COMPUTERNAME,
  [string]$Dir = '',
  [string]$CodexHome = '',
  [string]$CodexBinary = '',
  [ValidateSet('managed','external')][string]$ServerOwnership = 'managed',
  [string]$AppServerSocket = '',
  [string]$AppServerTokenFile = '',
  [switch]$PrivateCodexHome,
  [switch]$NoService,
  [switch]$NoStart
)
$ErrorActionPreference = 'Stop'
$relay = '__RELAY_URL__'
$token = '__WORKER_TOKEN__'
$team = '__TEAM_ID__'
$runtimeKind = '__RUNTIME_KIND__'
if ($runtimeKind.StartsWith('__')) { $runtimeKind = 'fork' }
if ($runtimeKind -notin @('fork','stock')) { throw 'Invalid installer runtime.' }
if (-not $Dir) {
  $suffix = if ($runtimeKind -eq 'stock') { '-stock' } else { '' }
  $Dir = Join-Path $env:LOCALAPPDATA "AgentTeams\mate-$($team.Substring(0,8))$suffix"
}
$Dir = [IO.Path]::GetFullPath($Dir)
if ($Dir.TrimEnd('\') -eq [IO.Path]::GetPathRoot($Dir).TrimEnd('\')) { throw 'Choose a new installation directory, not a drive root.' }
if (Test-Path (Join-Path $Dir 'config.json')) { throw 'This installation already exists. Use its bin\start.ps1 or choose another -Dir.' }
if (Test-Path $Dir) {
  if ((Get-Item $Dir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Installation directory must not be a link.' }
  if (Get-ChildItem $Dir -Force | Select-Object -First 1) { throw 'Choose a new or empty installation directory.' }
}
if ([Environment]::Is64BitProcess -eq $false) { throw 'Run this installer in 64-bit PowerShell.' }
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'This build requires Windows x64.' }
New-Item -ItemType Directory -Force $Dir | Out-Null
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
# Protect enrollment credentials and the local App Server capability before unpacking.
& icacls.exe $Dir /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not make installation directory private.' }
$worker = Join-Path $Dir 'worker'
New-Item -ItemType Directory -Force $worker | Out-Null
$archive = Join-Path $Dir 'worker.tgz'
$reader = [IO.File]::OpenText($PSCommandPath)
$output = [IO.File]::Create($archive)
try {
  while (($line = $reader.ReadLine()) -ne '__PAYLOAD_BELOW__') {
    if ($null -eq $line) { throw 'Installer payload is missing.' }
  }
  while ($null -ne ($line = $reader.ReadLine())) {
    if ($line -eq '#>') { break }
    if ($line) { $bytes = [Convert]::FromBase64String($line); $output.Write($bytes,0,$bytes.Length) }
  }
} finally { $reader.Dispose(); $output.Dispose() }
$systemTar = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path $systemTar -PathType Leaf)) { throw 'Windows built-in tar.exe is required.' }
& $systemTar -xzf $archive -C $worker
if ($LASTEXITCODE -ne 0) { throw 'Could not unpack the native runtime.' }
Remove-Item $archive
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if ($node) {
  & $node -e 'process.exit(process.versions.node.split(".")[0] === "24" && +process.versions.node.split(".")[1] >= 15 ? 0 : 1)'
  if ($LASTEXITCODE -ne 0) { $node = $null }
}
if (-not $node) {
  $version = 'v24.19.0'
  $name = "node-$version-win-x64.zip"
  $zip = Join-Path $Dir $name
  Invoke-WebRequest "https://nodejs.org/dist/$version/$name" -OutFile $zip -UseBasicParsing
  $checksums = (Invoke-WebRequest "https://nodejs.org/dist/$version/SHASUMS256.txt" -UseBasicParsing).Content
  $expected = (($checksums -split "`n" | Where-Object { $_.Trim().EndsWith("  $name") }) -split '\s+')[0]
  if (-not $expected -or (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Node download checksum mismatch.' }
  Expand-Archive $zip -DestinationPath (Join-Path $Dir 'node') -Force
  Remove-Item $zip
  $node = Join-Path $Dir "node\node-$version-win-x64\node.exe"
}
$env:AGENT_TEAMS_INSTALL_RUNTIME = $runtimeKind
$env:AGENT_TEAMS_INSTALL_CODEX_BINARY = $CodexBinary
$env:AGENT_TEAMS_INSTALL_SERVER_OWNERSHIP = $ServerOwnership
$env:AGENT_TEAMS_INSTALL_APP_SERVER_SOCKET = $AppServerSocket
$env:AGENT_TEAMS_INSTALL_APP_SERVER_TOKEN_FILE = $AppServerTokenFile
$env:AGENT_TEAMS_INSTALL_RELAY = $relay
$env:AGENT_TEAMS_INSTALL_TOKEN = $token
$env:AGENT_TEAMS_INSTALL_TEAM = $team
$env:AGENT_TEAMS_INSTALL_LABEL = $Label
$env:AGENT_TEAMS_INSTALL_CODEX_HOME = $CodexHome
$env:AGENT_TEAMS_INSTALL_PRIVATE_HOME = [string][bool]$PrivateCodexHome
$env:AGENT_TEAMS_INSTALL_NO_SERVICE = [string][bool]$NoService
$env:AGENT_TEAMS_INSTALL_NO_START = [string][bool]$NoStart
try {
  & $node (Join-Path $worker 'windows-install.mjs') install $Dir
  if ($LASTEXITCODE -ne 0) { throw 'Installation did not complete. See the error above.' }
} finally {
  Get-ChildItem Env:AGENT_TEAMS_INSTALL_* | Remove-Item
}
exit
<#
__PAYLOAD_BELOW__
