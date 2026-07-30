// @vitest-environment node
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PathLike } from 'fs';

const mockBuildMergedCliPath = vi.fn<(binaryPath: string | null) => string>();
const mockGetShellPreferredHome = vi.fn<() => string>();
const mockGetClaudeBasePath = vi.fn<() => string>();
const mockResolveInteractiveShellEnvBestEffort =
  vi.fn<(options?: unknown) => Promise<NodeJS.ProcessEnv>>();
const mockGetConfiguredCliFlavor = vi.fn<() => 'claude' | 'agent_teams_orchestrator'>();
const mockGetDoctorInvokedCandidates = vi.fn<(commandName: string) => Promise<string[]>>();

const accessMock = vi.fn<(filePath: PathLike, mode?: number) => Promise<void>>();
const statMock = vi.fn<(filePath: PathLike) => Promise<{ isFile: () => boolean }>>();

vi.mock('@main/utils/cliPathMerge', () => ({
  buildMergedCliPath: (binaryPath: string | null) => mockBuildMergedCliPath(binaryPath),
}));

vi.mock('@main/utils/shellEnv', () => ({
  getShellPreferredHome: () => mockGetShellPreferredHome(),
  resolveInteractiveShellEnvBestEffort: (options?: unknown) =>
    mockResolveInteractiveShellEnvBestEffort(options),
}));

vi.mock('@main/utils/pathDecoder', () => ({
  getClaudeBasePath: () => mockGetClaudeBasePath(),
}));

vi.mock('@main/services/team/cliFlavor', () => ({
  getConfiguredCliFlavor: () => mockGetConfiguredCliFlavor(),
}));

vi.mock('@main/services/team/ClaudeDoctorProbe', () => ({
  getDoctorInvokedCandidates: (commandName: string) => mockGetDoctorInvokedCandidates(commandName),
}));

vi.mock('fs', () => ({
  default: {
    constants: { X_OK: 1 },
    promises: {
      access: (filePath: PathLike, mode?: number) => accessMock(filePath, mode),
      stat: (filePath: PathLike) => statMock(filePath),
    },
  },
  constants: { X_OK: 1 },
  promises: {
    access: (filePath: PathLike, mode?: number) => accessMock(filePath, mode),
    stat: (filePath: PathLike) => statMock(filePath),
  },
}));

describe('ClaudeBinaryResolver', () => {
  const originalPlatform = process.platform;
  const originalCwd = process.cwd;
  const originalResourcesPath = process.resourcesPath;
  const originalPathext = process.env.PATHEXT;
  const workspaceRoot = '/Users/belief/dev/projects/claude/claude_team_runtime';

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockBuildMergedCliPath.mockReturnValue(['/usr/local/bin', '/usr/bin'].join(path.delimiter));
    mockGetShellPreferredHome.mockReturnValue('/Users/tester');
    mockGetClaudeBasePath.mockReturnValue('/Users/tester/.claude');
    mockResolveInteractiveShellEnvBestEffort.mockResolvedValue({});
    mockGetConfiguredCliFlavor.mockReturnValue('agent_teams_orchestrator');
    mockGetDoctorInvokedCandidates.mockResolvedValue([]);
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
      writable: true,
    });
    process.cwd = vi.fn(() => workspaceRoot);
    Object.defineProperty(process, 'resourcesPath', {
      value: '/Applications/Agent Teams AI.app/Contents/Resources',
      configurable: true,
      writable: true,
    });
    delete process.env.CLAUDE_CLI_PATH;
    delete process.env.CLAUDE_AGENT_TEAMS_ORCHESTRATOR_CLI_PATH;
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
      writable: true,
    });
    process.cwd = originalCwd;
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
      writable: true,
    });
    if (originalPathext === undefined) {
      delete process.env.PATHEXT;
    } else {
      process.env.PATHEXT = originalPathext;
    }
    vi.unstubAllEnvs();
  });

  it('resolves extensionless Windows explicit overrides to a real executable file first', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
      writable: true,
    });
    mockGetConfiguredCliFlavor.mockReturnValue('claude');
    process.env.PATHEXT = '.EXE;.CMD';
    process.env.CLAUDE_CLI_PATH = 'C:\\Tools\\claude';
    const expectedBinary = 'C:\\Tools\\claude.exe';

    statMock.mockImplementation((filePath) => {
      if (filePath === expectedBinary) {
        return Promise.resolve({ isFile: () => true });
      }
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });

    const { ClaudeBinaryResolver } = await import('@main/services/team/ClaudeBinaryResolver');
    ClaudeBinaryResolver.clearCache();

    await expect(ClaudeBinaryResolver.resolve()).resolves.toBe(expectedBinary);
    expect(statMock.mock.calls[0]?.[0]).toBe(expectedBinary);
  });

  it('finds npm-local Claude install in the vendor bin directory', async () => {
    mockGetConfiguredCliFlavor.mockReturnValue('claude');
    const expectedBinary = path.join(
      '/Users/tester/.claude',
      'local',
      'node_modules',
      '.bin',
      'claude'
    );

    accessMock.mockImplementation((filePath) => {
      if (filePath === expectedBinary) {
        return Promise.resolve();
      }
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });

    const { ClaudeBinaryResolver } = await import('@main/services/team/ClaudeBinaryResolver');
    ClaudeBinaryResolver.clearCache();

    await expect(ClaudeBinaryResolver.resolve()).resolves.toBe(expectedBinary);
    expect(accessMock).toHaveBeenCalledWith(expectedBinary, 1);
  });

  it('falls back to the doctor Invoked path when normal resolution misses the CLI', async () => {
    mockGetConfiguredCliFlavor.mockReturnValue('claude');
    mockGetDoctorInvokedCandidates.mockResolvedValue([
      '/Users/tester/.local/share/claude/versions/2.1.101',
    ]);
    const expectedBinary = '/Users/tester/.local/share/claude/versions/2.1.101';

    accessMock.mockImplementation((filePath) => {
      if (filePath === expectedBinary) {
        return Promise.resolve();
      }
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });

    const { ClaudeBinaryResolver } = await import('@main/services/team/ClaudeBinaryResolver');
    ClaudeBinaryResolver.clearCache();

    await expect(ClaudeBinaryResolver.resolve()).resolves.toBe(expectedBinary);
    expect(mockGetDoctorInvokedCandidates).toHaveBeenCalledWith('claude');
    expect(accessMock).toHaveBeenCalledWith(expectedBinary, 1);
  });
});
