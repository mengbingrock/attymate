import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { createDefaultCliExtensionCapabilities } from '@shared/utils/providerExtensionCapabilities';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CodexAccountSnapshotDto } from '@features/codex-account/contracts';
import type { CliInstallationStatus } from '@shared/types';
import type { SkillCatalogItem } from '@shared/types/extensions';
interface StoreState {
  fetchSkillsCatalog: ReturnType<typeof vi.fn>;
  fetchSkillDetail: ReturnType<typeof vi.fn>;
  skillsCatalogLoadingByProjectPath: Record<string, boolean>;
  skillsCatalogErrorByProjectPath: Record<string, string | null>;
  skillsDetailsById: Record<string, unknown>;
  skillsUserCatalog: SkillCatalogItem[];
  skillsLibraryCatalog: SkillCatalogItem[];
  skillsTeamCatalog: SkillCatalogItem[];
  skillsProjectCatalogByProjectPath: Record<string, SkillCatalogItem[]>;
  cliStatus: CliInstallationStatus | null;
  cliStatusLoading: boolean;
  appConfig: {
    general: {
      multimodelEnabled: boolean;
    };
  } | null;
}

const storeState = {} as StoreState;
const startWatchingMock = vi.fn();
const stopWatchingMock = vi.fn();
const onChangedMock = vi.fn();
const codexAccountHookState = {
  snapshot: null as CodexAccountSnapshotDto | null,
  loading: false,
  error: null as string | null,
  refresh: vi.fn(() => Promise.resolve(undefined)),
  startChatgptLogin: vi.fn(() => Promise.resolve(true)),
  cancelChatgptLogin: vi.fn(() => Promise.resolve(true)),
  logout: vi.fn(() => Promise.resolve(true)),
};
let skillsChangedHandler: ((event: {
  scope: 'user' | 'project';
  projectPath: string | null;
  path: string;
  type: 'create' | 'change' | 'delete';
}) => void) | null = null;

vi.mock('@renderer/store', () => ({
  useStore: (selector: (state: StoreState) => unknown) => selector(storeState),
}));

vi.mock('@features/codex-account/renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@features/codex-account/renderer')>();
  return {
    ...actual,
    useCodexAccountSnapshot: () => codexAccountHookState,
  };
});

vi.mock('zustand/react/shallow', () => ({
  useShallow: <T,>(selector: T) => selector,
}));

vi.mock('@renderer/api', () => ({
  api: {
    skills: {
      startWatching: (...args: unknown[]) => startWatchingMock(...args),
      stopWatching: (...args: unknown[]) => stopWatchingMock(...args),
      onChanged: (...args: unknown[]) => onChangedMock(...args),
    },
  },
}));

vi.mock('@renderer/components/ui/badge', () => ({
  Badge: ({ children }: React.PropsWithChildren) => React.createElement('span', null, children),
}));

vi.mock('@renderer/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    type = 'button',
  }: React.PropsWithChildren<{
    onClick?: () => void;
    type?: 'button' | 'submit' | 'reset';
    variant?: string;
    size?: string;
    className?: string;
  }>) =>
    React.createElement(
      'button',
      {
        type,
        onClick,
      },
      children
    ),
}));

vi.mock('@renderer/components/ui/popover', () => ({
  Popover: ({ children }: React.PropsWithChildren<{ open?: boolean; onOpenChange?: (open: boolean) => void }>) =>
    React.createElement(React.Fragment, null, children),
  PopoverTrigger: ({ children }: React.PropsWithChildren) =>
    React.createElement(React.Fragment, null, children),
  PopoverContent: ({ children }: React.PropsWithChildren) =>
    React.createElement('div', null, children),
}));

vi.mock('@renderer/components/ui/tooltip', () => ({
  Tooltip: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
  TooltipTrigger: ({ children }: React.PropsWithChildren) =>
    React.createElement(React.Fragment, null, children),
  TooltipContent: ({ children }: React.PropsWithChildren) => React.createElement('span', null, children),
}));

vi.mock('@renderer/components/extensions/common/SearchInput', () => ({
  SearchInput: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  }) =>
    React.createElement('input', {
      value,
      placeholder,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
    }),
}));

vi.mock('@renderer/components/extensions/skills/SkillDetailDialog', () => ({
  SkillDetailDialog: () => null,
}));

vi.mock('@renderer/components/extensions/skills/SkillEditorDialog', () => ({
  SkillEditorDialog: ({ allowCodexRootKind }: { allowCodexRootKind: boolean }) =>
    React.createElement('div', {
      'data-testid': 'skill-editor-dialog',
      'data-allow-codex-root-kind': String(allowCodexRootKind),
    }),
}));

vi.mock('@renderer/components/extensions/skills/SkillImportDialog', () => ({
  SkillImportDialog: ({ allowCodexRootKind }: { allowCodexRootKind: boolean }) =>
    React.createElement('div', {
      'data-testid': 'skill-import-dialog',
      'data-allow-codex-root-kind': String(allowCodexRootKind),
    }),
}));

vi.mock('lucide-react', () => {
  const Icon = (props: React.SVGProps<SVGSVGElement>) => React.createElement('svg', props);
  return {
    AlertTriangle: Icon,
    ArrowUpAZ: Icon,
    ArrowUpDown: Icon,
    BookOpen: Icon,
    Check: Icon,
    CheckCircle2: Icon,
    Clock3: Icon,
    Download: Icon,
    Plus: Icon,
    Search: Icon,
  };
});

import { SkillsPanel } from '@renderer/components/extensions/skills/SkillsPanel';

function makeUserSkill(): SkillCatalogItem {
  return {
    id: '/Users/me/.claude/skills/review-helper',
    sourceType: 'filesystem',
    name: 'Review Helper',
    description: 'Helps with code review',
    folderName: 'review-helper',
    scope: 'user',
    rootKind: 'claude',
    teamName: null,
    projectRoot: null,
    discoveryRoot: '/Users/me/.claude/skills',
    skillDir: '/Users/me/.claude/skills/review-helper',
    skillFile: '/Users/me/.claude/skills/review-helper/SKILL.md',
    metadata: {},
    invocationMode: 'auto',
    flags: {
      hasScripts: false,
      hasReferences: false,
      hasAssets: false,
    },
    isValid: true,
    issues: [],
    modifiedAt: 1,
  };
}

function makeCodexSkill(): SkillCatalogItem {
  return {
    ...makeUserSkill(),
    id: '/Users/me/.codex/skills/codex-helper',
    name: 'Codex Helper',
    description: 'Helps only Codex sessions',
    folderName: 'codex-helper',
    rootKind: 'codex',
    discoveryRoot: '/Users/me/.codex/skills',
    skillDir: '/Users/me/.codex/skills/codex-helper',
    skillFile: '/Users/me/.codex/skills/codex-helper/SKILL.md',
  };
}

function makeLibrarySkill(): SkillCatalogItem {
  return {
    ...makeUserSkill(),
    id: '/Users/me/Library/App/skills/library/library-helper',
    name: 'Library Helper',
    description: 'Available in every runtime',
    folderName: 'library-helper',
    scope: 'library',
    rootKind: 'library',
    discoveryRoot: '/Users/me/Library/App/skills/library',
    skillDir: '/Users/me/Library/App/skills/library/library-helper',
    skillFile: '/Users/me/Library/App/skills/library/library-helper/SKILL.md',
  };
}

function makeTeamSkill(): SkillCatalogItem {
  return {
    ...makeLibrarySkill(),
    id: '/Users/me/Library/App/skills/teams/matter-team/team-helper',
    name: 'Team Helper',
    description: 'Shared with one team',
    folderName: 'team-helper',
    scope: 'team',
    teamName: 'matter-team',
    discoveryRoot: '/Users/me/Library/App/skills/teams/matter-team',
    skillDir: '/Users/me/Library/App/skills/teams/matter-team/team-helper',
    skillFile: '/Users/me/Library/App/skills/teams/matter-team/team-helper/SKILL.md',
  };
}

function makeMultimodelStatus(
  overrides?: Partial<CliInstallationStatus>
): CliInstallationStatus {
  return {
    flavor: 'claude',
    displayName: 'Multimodel runtime',
    supportsSelfUpdate: false,
    showVersionDetails: true,
    showBinaryPath: true,
    installed: true,
    installedVersion: '1.0.0',
    binaryPath: '/usr/local/bin/agent-teams',
    latestVersion: '1.0.0',
    updateAvailable: false,
    authLoggedIn: false,
    authStatusChecking: false,
    authMethod: null,
    providers: [
      {
        providerId: 'anthropic',
        displayName: 'Anthropic',
        supported: true,
        authenticated: true,
        authMethod: 'oauth',
        verificationState: 'verified',
        statusMessage: 'Connected',
        models: [],
        canLoginFromUi: true,
        capabilities: {
          teamLaunch: true,
          oneShot: true,
          extensions: createDefaultCliExtensionCapabilities({
            plugins: { status: 'supported', ownership: 'provider-scoped', reason: null },
          }),
        },
        connection: null,
        backend: null,
      },
    ],
    ...overrides,
  };
}

describe('SkillsPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    storeState.fetchSkillsCatalog = vi.fn().mockResolvedValue(undefined);
    storeState.fetchSkillDetail = vi.fn().mockResolvedValue(undefined);
    storeState.skillsCatalogLoadingByProjectPath = {};
    storeState.skillsCatalogErrorByProjectPath = {};
    storeState.skillsDetailsById = {};
    storeState.skillsUserCatalog = [makeUserSkill()];
    storeState.skillsLibraryCatalog = [];
    storeState.skillsTeamCatalog = [];
    storeState.skillsProjectCatalogByProjectPath = {
      '/tmp/project-a': [],
    };
    storeState.cliStatusLoading = false;
    storeState.appConfig = {
      general: {
        multimodelEnabled: true,
      },
    };
    storeState.cliStatus = {
      flavor: 'claude',
      displayName: 'Claude CLI',
      supportsSelfUpdate: true,
      showVersionDetails: true,
      showBinaryPath: true,
      installed: true,
      installedVersion: '1.0.0',
      binaryPath: '/usr/local/bin/claude',
      latestVersion: '1.0.0',
      updateAvailable: false,
      authLoggedIn: true,
      authStatusChecking: false,
      authMethod: 'oauth',
      providers: [],
    };
    codexAccountHookState.snapshot = null;
    codexAccountHookState.loading = false;
    codexAccountHookState.error = null;
    startWatchingMock.mockReset();
    stopWatchingMock.mockReset();
    onChangedMock.mockReset();
    skillsChangedHandler = null;
    startWatchingMock.mockResolvedValue('watch-1');
    onChangedMock.mockImplementation((handler: typeof skillsChangedHandler) => {
      skillsChangedHandler = handler;
      return () => {
        skillsChangedHandler = null;
      };
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('refetches personal skill details without forcing the current project path', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const skill = storeState.skillsUserCatalog[0]!;

    await act(async () => {
      root.render(
        React.createElement(SkillsPanel, {
          projectPath: '/tmp/project-a',
          projectLabel: 'Project A',
          skillsSearchQuery: '',
          setSkillsSearchQuery: vi.fn(),
          skillsSort: 'name-asc',
          setSkillsSort: vi.fn(),
          selectedSkillId: skill.id,
          setSelectedSkillId: vi.fn(),
        })
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(startWatchingMock).toHaveBeenCalledWith('/tmp/project-a');
    expect(skillsChangedHandler).not.toBeNull();

    await act(async () => {
      skillsChangedHandler?.({
        scope: 'user',
        projectPath: null,
        path: `${skill.skillDir}/SKILL.md`,
        type: 'change',
      });
      await Promise.resolve();
    });

    expect(storeState.fetchSkillsCatalog).toHaveBeenCalledWith('/tmp/project-a');
    expect(storeState.fetchSkillDetail).toHaveBeenCalledWith(skill.id, undefined);

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('groups library and team skills into their own sections with the team name', async () => {
    storeState.skillsLibraryCatalog = [makeLibrarySkill()];
    storeState.skillsTeamCatalog = [makeTeamSkill()];

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        React.createElement(SkillsPanel, {
          projectPath: '/tmp/project-a',
          projectLabel: 'Project A',
          skillsSearchQuery: '',
          setSkillsSearchQuery: vi.fn(),
          skillsSort: 'name-asc',
          setSkillsSort: vi.fn(),
          selectedSkillId: null,
          setSelectedSkillId: vi.fn(),
        })
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('App library skills');
    expect(host.textContent).toContain('Library Helper');
    expect(host.textContent).toContain('Team skills');
    expect(host.textContent).toContain('Team: matter-team');
    expect(host.textContent).toContain('Stored in App library');

    const teamFilterButton = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'Team'
    ) as HTMLButtonElement;
    expect(teamFilterButton).toBeDefined();

    await act(async () => {
      teamFilterButton.click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Team Helper');
    expect(host.textContent).not.toContain('Library Helper');
    expect(host.textContent).not.toContain('Review Helper');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('hides codex-only create and import affordances when codex runtime is unavailable', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        React.createElement(SkillsPanel, {
          projectPath: '/tmp/project-a',
          projectLabel: 'Project A',
          skillsSearchQuery: '',
          setSkillsSearchQuery: vi.fn(),
          skillsSort: 'name-asc',
          setSkillsSort: vi.fn(),
          selectedSkillId: null,
          setSelectedSkillId: vi.fn(),
        })
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).not.toContain('Codex only');
    for (const node of host.querySelectorAll('[data-testid="skill-editor-dialog"]')) {
      expect(node.getAttribute('data-allow-codex-root-kind')).toBe('false');
    }
    const importDialog = host.querySelector('[data-testid="skill-import-dialog"]');
    expect(importDialog?.getAttribute('data-allow-codex-root-kind')).toBe('false');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('resets the codex-only quick filter when codex entries disappear', async () => {
    storeState.cliStatus = makeMultimodelStatus({
      providers: [
        ...makeMultimodelStatus().providers,
        {
          providerId: 'codex',
          displayName: 'Codex',
          supported: true,
          authenticated: true,
          authMethod: 'api_key',
          verificationState: 'verified',
          statusMessage: 'Connected',
          models: [],
          canLoginFromUi: true,
          capabilities: {
            teamLaunch: true,
            oneShot: true,
            extensions: createDefaultCliExtensionCapabilities({
              plugins: { status: 'unsupported', ownership: 'provider-scoped', reason: null },
            }),
          },
          connection: null,
          backend: null,
        },
      ],
    });
    storeState.skillsUserCatalog = [makeUserSkill(), makeCodexSkill()];

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        React.createElement(SkillsPanel, {
          projectPath: '/tmp/project-a',
          projectLabel: 'Project A',
          skillsSearchQuery: '',
          setSkillsSearchQuery: vi.fn(),
          skillsSort: 'name-asc',
          setSkillsSort: vi.fn(),
          selectedSkillId: null,
          setSelectedSkillId: vi.fn(),
        })
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const codexOnlyButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Codex only')
    );
    expect(codexOnlyButton).toBeDefined();

    await act(async () => {
      (codexOnlyButton as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Codex Helper');
    expect(host.textContent).not.toContain('Review Helper');

    storeState.cliStatus = {
      ...storeState.cliStatus,
      providers: storeState.cliStatus.providers.filter((provider) => provider.providerId !== 'codex'),
    };
    storeState.skillsUserCatalog = [makeUserSkill()];

    await act(async () => {
      root.render(
        React.createElement(SkillsPanel, {
          projectPath: '/tmp/project-a',
          projectLabel: 'Project A',
          skillsSearchQuery: '',
          setSkillsSearchQuery: vi.fn(),
          skillsSort: 'name-asc',
          setSkillsSort: vi.fn(),
          selectedSkillId: null,
          setSelectedSkillId: vi.fn(),
        })
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Review Helper');
    expect(host.textContent).not.toContain('Codex Helper');
    expect(host.textContent).not.toContain('No skills yet');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });
});
