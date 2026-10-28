import { resolve } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import {
  readCodexConfig,
  withCodexConfigLock,
  writeCodexConfigAtomically,
} from './codexConfigTransaction';
import { OWNER_CONTROL_BRIDGE_TOOL_NAMES } from './controlMcpServer';
import {
  LEGACY_OWNER_CONTROL_SERVER_NAME,
  validateCodexMcpServerName,
} from './codexMcpServerNames';

export {
  controlMcpServerNameForInstallation,
  isOwnerControlServerName,
  LEGACY_OWNER_CONTROL_SERVER_NAME,
  validateCodexMcpServerName,
} from './codexMcpServerNames';

export interface CodexMcpRegistrationSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly serverName?: string;
}

export type CodexMcpRegistrationState =
  | { readonly status: 'absent' }
  | { readonly status: 'managed'; readonly block: string }
  | {
      readonly status: 'conflict';
      readonly reason: 'unmanaged_server_table' | 'managed_target_mismatch';
    }
  | {
      readonly status: 'invalid';
      readonly reason: 'unbalanced_managed_markers' | 'invalid_managed_block';
    };

export interface CodexMcpRegistrationChange {
  readonly configPath: string;
  readonly changed: boolean;
  readonly state: CodexMcpRegistrationState;
}

const marker = (side: 'start' | 'end', name: string): string =>
  `# ${side === 'start' ? '>>>' : '<<<'} agent-teams-worker managed: ${name}`;
const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tomlStringArray = (values: readonly string[]): string =>
  `[${values.map((value) => JSON.stringify(value)).join(', ')}]`;

export const buildCodexMcpRegistrationBlock = (spec: CodexMcpRegistrationSpec): string => {
  const name = validateCodexMcpServerName(spec.serverName);
  return [
    marker('start', name),
    `[mcp_servers.${name}]`,
    `command = ${JSON.stringify(spec.command)}`,
    `args = ${tomlStringArray(spec.args)}`,
    ...(spec.cwd === undefined ? [] : [`cwd = ${JSON.stringify(spec.cwd)}`]),
    'enabled = true',
    'required = false',
    'startup_timeout_sec = 10',
    'tool_timeout_sec = 30',
    'default_tools_approval_mode = "prompt"',
    `enabled_tools = ${tomlStringArray(OWNER_CONTROL_BRIDGE_TOOL_NAMES)}`,
    marker('end', name),
    '',
  ].join('\n');
};

const markerMatches = (content: string, side: 'start' | 'end', name: string) => [
  ...content.matchAll(new RegExp(`^${escapeRegex(marker(side, name))}\\r?$`, 'gm')),
];

const findManagedRange = (content: string, name: string) => {
  const start = markerMatches(content, 'start', name)[0]?.index;
  const endMatch = markerMatches(content, 'end', name)[0];
  if (start === undefined || endMatch?.index === undefined) return undefined;
  const markerEnd = endMatch.index + endMatch[0].length;
  const end = content[markerEnd] === '\n' ? markerEnd + 1 : markerEnd;
  return { start, end, block: content.slice(start, end) };
};

const managedTarget = (block: string, name: string): Record<string, unknown> | undefined => {
  try {
    const parsed = parseToml(block) as Record<string, unknown>;
    const servers = parsed.mcp_servers as Record<string, Record<string, unknown>> | undefined;
    if (
      Object.keys(parsed).length !== 1 ||
      !servers ||
      Object.keys(servers).length !== 1 ||
      !Object.hasOwn(servers, name)
    )
      return undefined;
    const target = servers[name];
    if (
      !target ||
      typeof target.command !== 'string' ||
      !Array.isArray(target.args) ||
      !target.args.every((value) => typeof value === 'string')
    )
      return undefined;
    return target;
  } catch {
    return undefined;
  }
};

export const inspectCodexMcpRegistration = (
  content: string,
  serverName = LEGACY_OWNER_CONTROL_SERVER_NAME
): CodexMcpRegistrationState => {
  const name = validateCodexMcpServerName(serverName);
  const starts = markerMatches(content, 'start', name);
  const ends = markerMatches(content, 'end', name);
  if (
    starts.length !== ends.length ||
    starts.length > 1 ||
    (starts[0] && ends[0] && starts[0].index! >= ends[0].index!)
  ) {
    return { status: 'invalid', reason: 'unbalanced_managed_markers' };
  }
  const managed = findManagedRange(content, name);
  if (managed && !managedTarget(managed.block, name)) {
    return { status: 'invalid', reason: 'invalid_managed_block' };
  }
  const outside = managed ? content.slice(0, managed.start) + content.slice(managed.end) : content;
  const table = new RegExp(
    `^\\s*\\[mcp_servers\\.(?:${escapeRegex(name)}|"${escapeRegex(name)}"|'${escapeRegex(name)}')\\]\\s*(?:#.*)?$`,
    'm'
  );
  if (table.test(outside)) return { status: 'conflict', reason: 'unmanaged_server_table' };
  return managed ? { status: 'managed', block: managed.block } : { status: 'absent' };
};

const matchesTarget = (
  block: string,
  name: string,
  expected: CodexMcpRegistrationSpec
): boolean => {
  const target = managedTarget(block, name);
  return (
    target?.command === expected.command &&
    JSON.stringify(target.args) === JSON.stringify(expected.args) &&
    target.cwd === expected.cwd
  );
};

export const installCodexMcpRegistration = async (
  configPath: string,
  spec: CodexMcpRegistrationSpec
): Promise<CodexMcpRegistrationChange> => {
  const name = validateCodexMcpServerName(spec.serverName);
  return withCodexConfigLock(resolve(configPath), async () => {
    const content = await readCodexConfig(configPath);
    const state = inspectCodexMcpRegistration(content, name);
    if (state.status === 'conflict' || state.status === 'invalid')
      return { configPath, changed: false, state };
    const nextBlock = buildCodexMcpRegistrationBlock(spec);
    if (
      state.status === 'managed' &&
      name !== LEGACY_OWNER_CONTROL_SERVER_NAME &&
      !matchesTarget(state.block, name, spec)
    ) {
      return {
        configPath,
        changed: false,
        state: { status: 'conflict', reason: 'managed_target_mismatch' },
      };
    }
    const range = findManagedRange(content, name);
    if (range?.block === nextBlock) return { configPath, changed: false, state };
    const separator = content.length === 0 ? '' : content.endsWith('\n') ? '\n' : '\n\n';
    const next = range
      ? content.slice(0, range.start) + nextBlock + content.slice(range.end)
      : content + separator + nextBlock;
    await writeCodexConfigAtomically(configPath, content, next);
    return { configPath, changed: true, state: { status: 'managed', block: nextBlock } };
  });
};

export const removeCodexMcpRegistration = async (
  configPath: string,
  serverName = LEGACY_OWNER_CONTROL_SERVER_NAME,
  expectedTarget?: CodexMcpRegistrationSpec
): Promise<CodexMcpRegistrationChange> => {
  const name = validateCodexMcpServerName(serverName);
  return withCodexConfigLock(resolve(configPath), async () => {
    const content = await readCodexConfig(configPath);
    const state = inspectCodexMcpRegistration(content, name);
    if (state.status !== 'managed') return { configPath, changed: false, state };
    if (expectedTarget && !matchesTarget(state.block, name, expectedTarget)) {
      return {
        configPath,
        changed: false,
        state: { status: 'conflict', reason: 'managed_target_mismatch' },
      };
    }
    const range = findManagedRange(content, name)!;
    const start =
      range.start > 0 && content[range.start - 1] === '\n' ? range.start - 1 : range.start;
    await writeCodexConfigAtomically(
      configPath,
      content,
      content.slice(0, start) + content.slice(range.end)
    );
    return { configPath, changed: true, state: { status: 'absent' } };
  });
};

export const readCodexMcpRegistrationState = async (
  configPath: string,
  serverName = LEGACY_OWNER_CONTROL_SERVER_NAME
): Promise<CodexMcpRegistrationState> =>
  inspectCodexMcpRegistration(await readCodexConfig(configPath), serverName);
