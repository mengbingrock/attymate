import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { OWNER_CONTROL_BRIDGE_TOOL_NAMES } from './controlMcpServer';

const SERVER_NAME = 'agent-teams-control';
const START_MARKER = '# >>> agent-teams-worker managed: agent-teams-control';
const END_MARKER = '# <<< agent-teams-worker managed: agent-teams-control';
const UNMANAGED_TABLE_PATTERN = /^\s*\[mcp_servers\.(?:agent-teams-control|"agent-teams-control")\]\s*(?:#.*)?$/m;

export interface CodexMcpRegistrationSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
}

export type CodexMcpRegistrationState =
  | { readonly status: 'absent' }
  | { readonly status: 'managed'; readonly block: string }
  | { readonly status: 'conflict'; readonly reason: 'unmanaged_server_table' }
  | { readonly status: 'invalid'; readonly reason: 'unbalanced_managed_markers' };

export interface CodexMcpRegistrationChange {
  readonly configPath: string;
  readonly changed: boolean;
  readonly state: CodexMcpRegistrationState;
}

const tomlString = (value: string): string => JSON.stringify(value);
const tomlStringArray = (values: readonly string[]): string =>
  `[${values.map(tomlString).join(', ')}]`;

export const buildCodexMcpRegistrationBlock = (spec: CodexMcpRegistrationSpec): string => {
  const lines = [
    START_MARKER,
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${tomlString(spec.command)}`,
    `args = ${tomlStringArray(spec.args)}`,
    ...(spec.cwd === undefined ? [] : [`cwd = ${tomlString(spec.cwd)}`]),
    'enabled = true',
    'required = false',
    'startup_timeout_sec = 10',
    'tool_timeout_sec = 30',
    'default_tools_approval_mode = "prompt"',
    `enabled_tools = ${tomlStringArray(OWNER_CONTROL_BRIDGE_TOOL_NAMES)}`,
    END_MARKER,
  ];
  return `${lines.join('\n')}\n`;
};

const findManagedRange = (
  content: string
): { readonly start: number; readonly end: number; readonly block: string } | undefined => {
  const start = content.indexOf(START_MARKER);
  const endMarkerStart = content.indexOf(END_MARKER);
  if (start < 0 || endMarkerStart < 0) return undefined;
  const markerEnd = endMarkerStart + END_MARKER.length;
  const end = content[markerEnd] === '\n' ? markerEnd + 1 : markerEnd;
  return { start, end, block: content.slice(start, end) };
};

export const inspectCodexMcpRegistration = (content: string): CodexMcpRegistrationState => {
  const startCount = content.split(START_MARKER).length - 1;
  const endCount = content.split(END_MARKER).length - 1;
  if (startCount !== endCount || startCount > 1) {
    return { status: 'invalid', reason: 'unbalanced_managed_markers' };
  }
  const managed = findManagedRange(content);
  if (managed !== undefined) {
    const outsideManagedBlock = `${content.slice(0, managed.start)}${content.slice(managed.end)}`;
    if (UNMANAGED_TABLE_PATTERN.test(outsideManagedBlock)) {
      return { status: 'conflict', reason: 'unmanaged_server_table' };
    }
    return { status: 'managed', block: managed.block };
  }
  if (UNMANAGED_TABLE_PATTERN.test(content)) {
    return { status: 'conflict', reason: 'unmanaged_server_table' };
  }
  return { status: 'absent' };
};

const readConfig = async (configPath: string): Promise<string> => {
  try {
    return await readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
};

const writeConfigAtomically = async (configPath: string, content: string): Promise<void> => {
  parseToml(content);
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  let existingMode = 0o600;
  try {
    const stat = await lstat(configPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to replace symlinked Codex config: ${configPath}`);
    }
    if (!stat.isFile()) throw new Error(`Codex config path is not a file: ${configPath}`);
    existingMode = stat.mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const temporaryPath = `${configPath}.agent-teams-${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: 'utf8', mode: existingMode });
    await chmod(temporaryPath, existingMode);
    await rename(temporaryPath, configPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
};

export const installCodexMcpRegistration = async (
  configPath: string,
  spec: CodexMcpRegistrationSpec
): Promise<CodexMcpRegistrationChange> => {
  const content = await readConfig(configPath);
  const state = inspectCodexMcpRegistration(content);
  if (state.status === 'conflict' || state.status === 'invalid') {
    return { configPath, changed: false, state };
  }

  const nextBlock = buildCodexMcpRegistrationBlock(spec);
  let nextContent: string;
  if (state.status === 'managed') {
    const range = findManagedRange(content);
    if (range === undefined) throw new Error('Managed Codex MCP block disappeared during update');
    if (range.block === nextBlock) return { configPath, changed: false, state };
    nextContent = `${content.slice(0, range.start)}${nextBlock}${content.slice(range.end)}`;
  } else {
    const separator = content.length === 0 ? '' : content.endsWith('\n') ? '\n' : '\n\n';
    nextContent = `${content}${separator}${nextBlock}`;
  }

  await writeConfigAtomically(configPath, nextContent);
  return {
    configPath,
    changed: true,
    state: { status: 'managed', block: nextBlock },
  };
};

export const removeCodexMcpRegistration = async (
  configPath: string
): Promise<CodexMcpRegistrationChange> => {
  const content = await readConfig(configPath);
  const state = inspectCodexMcpRegistration(content);
  if (state.status !== 'managed') return { configPath, changed: false, state };
  const range = findManagedRange(content);
  if (range === undefined) throw new Error('Managed Codex MCP block disappeared during removal');

  let start = range.start;
  if (start > 0 && content[start - 1] === '\n') start -= 1;
  await writeConfigAtomically(configPath, `${content.slice(0, start)}${content.slice(range.end)}`);
  return { configPath, changed: true, state: { status: 'absent' } };
};

export const readCodexMcpRegistrationState = async (
  configPath: string
): Promise<CodexMcpRegistrationState> => inspectCodexMcpRegistration(await readConfig(configPath));
