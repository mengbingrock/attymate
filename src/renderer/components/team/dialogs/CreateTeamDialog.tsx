import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  reconcileAnthropicRuntimeSelections,
  resolveAnthropicFastMode,
  resolveAnthropicRuntimeSelection,
} from '@features/anthropic-runtime-profile/renderer';
import {
  isCodexAccountSnapshotPending,
  mergeCodexCliStatusWithSnapshot,
  useCodexAccountSnapshot,
} from '@features/codex-account/renderer';
import {
  buildCodexFastModeArgs,
  reconcileCodexRuntimeSelections,
  resolveCodexFastMode,
  resolveCodexRuntimeSelection,
} from '@features/codex-runtime-profile/renderer';
import { useAppTranslation } from '@features/localization/renderer';
import { api } from '@renderer/api';
import { ProviderActivityStatusStrip } from '@renderer/components/common/ProviderActivityStatusStrip';
import {
  buildMemberDraftColorMap,
  buildMemberDraftSuggestions,
  buildMembersFromDrafts,
  clearMemberModelOverrides,
  createMemberDraft,
  normalizeLeadProviderForMode,
  normalizeMemberDraftForProviderMode,
  validateMemberNameInline,
} from '@renderer/components/team/members/MembersEditorSection';
import { TeamRosterEditorSection } from '@renderer/components/team/members/TeamRosterEditorSection';
import { AutoResizeTextarea } from '@renderer/components/ui/auto-resize-textarea';
import { Button } from '@renderer/components/ui/button';
import { Checkbox } from '@renderer/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { MentionableTextarea } from '@renderer/components/ui/MentionableTextarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { getTeamColorSet, getThemedBadge } from '@renderer/constants/teamColors';
import { useChipDraftPersistence } from '@renderer/hooks/useChipDraftPersistence';
import { useCreateTeamDraft } from '@renderer/hooks/useCreateTeamDraft';
import { useDraftPersistence } from '@renderer/hooks/useDraftPersistence';
import { useOpenCodeCatalogPrefetch } from '@renderer/hooks/useOpenCodeCatalogPrefetch';
import { useTaskSuggestions } from '@renderer/hooks/useTaskSuggestions';
import { useTeamSuggestions } from '@renderer/hooks/useTeamSuggestions';
import { useTheme } from '@renderer/hooks/useTheme';
import { cn } from '@renderer/lib/utils';
import {
  applyStoredCreateTeamMemberRuntimePreferences,
  getStoredCreateTeamEffort,
  getStoredCreateTeamFastMode as getStoredTeamFastMode,
  getStoredCreateTeamLimitContext,
  getStoredCreateTeamMemberRuntimePreferences,
  getStoredCreateTeamModel as getStoredTeamModel,
  getStoredCreateTeamProvider as getStoredTeamProvider,
  getStoredCreateTeamSkipPermissions,
  migrateLegacyCreateTeamPreferences,
  setStoredCreateTeamEffort,
  setStoredCreateTeamFastMode,
  setStoredCreateTeamLimitContext,
  setStoredCreateTeamMemberRuntimePreferences,
  setStoredCreateTeamModel,
  setStoredCreateTeamProvider,
  setStoredCreateTeamSkipPermissions,
} from '@renderer/services/createTeamPreferences';
import { useStore } from '@renderer/store';
import { createLoadingMultimodelCliStatus } from '@renderer/store/slices/cliInstallerSlice';
import { isGeminiUiFrozen } from '@renderer/utils/geminiUiFreeze';
import { resolveUiOwnedProviderBackendId } from '@renderer/utils/providerBackendIdentity';
import { refreshCliStatusForCurrentMode } from '@renderer/utils/refreshCliStatus';
import { getAvailableTeamEffortValue } from '@renderer/utils/teamEffortOptions';
import {
  getTeamModelSelectionError,
  isTeamProviderRuntimeStatusLoading,
  normalizeExplicitTeamModelForUi,
} from '@renderer/utils/teamModelAvailability';
import { resolveTeamLeadColorName } from '@shared/utils/teamMemberColors';
import { isTeamProviderId, normalizeOptionalTeamProviderId } from '@shared/utils/teamProvider';
import { Info, Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { AdvancedCliSection } from './AdvancedCliSection';
import { AnthropicFastModeSelector } from './AnthropicFastModeSelector';
import { CodexFastModeSelector } from './CodexFastModeSelector';
import { clearInheritedMemberModelsUnavailableForProvider } from './memberModelScope';
import { OptionalSettingsSection } from './OptionalSettingsSection';
import { SkipPermissionsCheckbox } from './SkipPermissionsCheckbox';
import {
  analyzeTeammateRuntimeCompatibility,
  useTmuxRuntimeReadiness,
} from './teammateRuntimeCompatibility';
import { TeammateRuntimeCompatibilityNotice } from './TeammateRuntimeCompatibilityNotice';
import { computeEffectiveTeamModel } from './TeamModelSelector';
import { getNextSuggestedTeamName } from './teamNameSets';

import type {
  OrganizationPlacementSelection,
  OrganizationStructurePayload,
  OrganizationStructureUnitDto,
} from '@features/organizations/contracts';
import type { MemberDraft } from '@renderer/components/team/members/MembersEditorSection';
import type { EffortLevel, TeamCreateRequest, TeamFastMode, TeamProviderId } from '@shared/types';

const TEAM_COLOR_NAMES = [
  'blue',
  'green',
  'red',
  'yellow',
  'purple',
  'cyan',
  'orange',
  'pink',
] as const;

const APP_TEAM_RUNTIME_DISALLOWED_TOOLS = 'TeamDelete,TodoWrite,TaskCreate,TaskUpdate';

export interface TeamCopyData extends Pick<
  TeamCreateRequest,
  | 'description'
  | 'color'
  | 'prompt'
  | 'providerId'
  | 'model'
  | 'effort'
  | 'fastMode'
  | 'limitContext'
  | 'skipPermissions'
  | 'members'
> {
  teamName: string;
  cwd?: string;
}

export interface ActiveTeamRef {
  teamName: string;
  displayName: string;
  projectPath: string;
}

interface OrganizationPlacementUnitOption {
  unit: OrganizationStructureUnitDto;
  depth: number;
}

function compareOrganizationPlacementUnits(
  left: OrganizationStructureUnitDto,
  right: OrganizationStructureUnitDto
): number {
  if (left.kind === 'organization' && right.kind !== 'organization') return -1;
  if (right.kind === 'organization' && left.kind !== 'organization') return 1;
  return getOrganizationUnitLabel(left).localeCompare(getOrganizationUnitLabel(right));
}

function getOrganizationPlacementUnitOptions(
  structure: OrganizationStructurePayload | null,
  organizationId: string
): OrganizationPlacementUnitOption[] {
  if (!structure) return [];
  const units = structure.units.filter(
    (unit) => unit.organizationId === organizationId && unit.kind !== 'team'
  );
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const organizationRootId =
    structure.organizations.find((organization) => organization.id === organizationId)
      ?.rootNodeId ?? null;
  const rootUnit =
    (organizationRootId ? unitById.get(organizationRootId) : undefined) ??
    units.find((unit) => unit.kind === 'organization') ??
    null;
  const childrenByParentId = new Map<string | null, OrganizationStructureUnitDto[]>();

  for (const unit of units) {
    const parentId =
      unit.parentId && unitById.has(unit.parentId)
        ? unit.parentId
        : unit.kind !== 'organization' && rootUnit && unit.id !== rootUnit.id
          ? rootUnit.id
          : null;
    const children = childrenByParentId.get(parentId) ?? [];
    children.push(unit);
    childrenByParentId.set(parentId, children);
  }

  for (const children of childrenByParentId.values()) {
    children.sort(compareOrganizationPlacementUnits);
  }

  const ordered: OrganizationPlacementUnitOption[] = [];
  const visited = new Set<string>();
  const visit = (unit: OrganizationStructureUnitDto, depth: number): void => {
    if (visited.has(unit.id)) return;
    visited.add(unit.id);
    ordered.push({ unit, depth });
    for (const child of childrenByParentId.get(unit.id) ?? []) {
      visit(child, depth + 1);
    }
  };

  for (const root of childrenByParentId.get(null) ?? []) {
    visit(root, 0);
  }
  for (const unit of units.sort(compareOrganizationPlacementUnits)) {
    visit(unit, 0);
  }

  return ordered;
}

function getOrganizationUnitLabel(unit: OrganizationStructureUnitDto): string {
  return unit.title ? `${unit.label} - ${unit.title}` : unit.label;
}

type OrganizationPlacementUnitKindKey =
  | 'create.organizationPlacement.kind.root'
  | 'create.organizationPlacement.kind.group';

function getOrganizationPlacementUnitKindKey(
  unit: OrganizationStructureUnitDto
): OrganizationPlacementUnitKindKey {
  return unit.kind === 'organization'
    ? 'create.organizationPlacement.kind.root'
    : 'create.organizationPlacement.kind.group';
}

interface CreateTeamDialogProps {
  open: boolean;
  canCreate: boolean;
  provisioningErrorsByTeam: Record<string, string | null>;
  clearProvisioningError?: (teamName?: string) => void;
  existingTeamNames: string[];
  /** Team names currently in active provisioning (launching) — used to prevent name conflicts. */
  provisioningTeamNames?: string[];
  /** Unused by the dialog (folder selection moved to the launch dialog); kept for call-site compatibility. */
  activeTeams?: ActiveTeamRef[];
  initialData?: TeamCopyData;
  initialOrganizationPlacement?: OrganizationPlacementSelection | null;
  /** Unused by the dialog (folder selection moved to the launch dialog); kept for call-site compatibility. */
  defaultProjectPath?: string | null;
  /** Unused by the dialog (folder selection moved to the launch dialog); kept for call-site compatibility. */
  forceDefaultProjectSelection?: boolean;
  onClose: () => void;
  /** Called after a launch-requested draft was created; the parent opens the launch dialog. */
  onLaunchAfterCreate?: (teamName: string) => void;
  onOpenTeam: (teamName: string, projectPath?: string) => void;
}

interface ValidationResult {
  valid: boolean;
  errors?: {
    teamName?: string;
    members?: string;
  };
}

import { CUSTOM_ROLE, PRESET_ROLES } from '@renderer/constants/teamRoles';

const DEFAULT_MEMBERS: { name: string; roleSelection: string; workflowKind?: 'reviewer' }[] = [
  {
    name: 'alice',
    roleSelection: 'reviewer',
    workflowKind: 'reviewer',
  },
  {
    name: 'tom',
    roleSelection: 'developer',
  },
  { name: 'bob', roleSelection: 'developer' },
  { name: 'jack', roleSelection: 'developer' },
];

/** Mirrors Claude CLI's `zuA()` sanitization: non-alphanumeric → `-`, then lowercase. */
function sanitizeTeamName(name: string): string {
  let result = name
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-{2,}/g, '-')
    .toLowerCase();
  // Trim leading/trailing dashes without backtracking-vulnerable regex
  while (result.startsWith('-')) result = result.slice(1);
  while (result.endsWith('-')) result = result.slice(0, -1);
  return result;
}

function validateTeamNameInline(
  name: string,
  t: ReturnType<typeof useAppTranslation>['t']
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const sanitized = sanitizeTeamName(trimmed);
  if (!sanitized) {
    return t('create.validation.nameMustContainLetterOrDigit');
  }
  if (sanitized.length > 128) {
    return t('create.validation.nameTooLong');
  }
  return null;
}

function buildDefaultTeamDescription(
  teamName: string,
  t: ReturnType<typeof useAppTranslation>['t']
): string {
  const trimmedName = teamName.trim();
  return trimmedName.length > 0
    ? t('create.defaultDescription.named', { teamName: trimmedName })
    : t('create.defaultDescription.fallback');
}

function validateRequest(
  request: TeamCreateRequest,
  t: ReturnType<typeof useAppTranslation>['t']
): ValidationResult {
  const sanitized = sanitizeTeamName(request.teamName);
  if (!sanitized) {
    return {
      valid: false,
      errors: {
        teamName: t('create.validation.nameMustContainLetterOrDigit'),
      },
    };
  }
  if (sanitized.length > 128) {
    return {
      valid: false,
      errors: {
        teamName: t('create.validation.nameTooLong'),
      },
    };
  }
  if (request.members.some((member) => !member.name.trim())) {
    return {
      valid: false,
      errors: {
        members: t('create.validation.memberNameRequired'),
      },
    };
  }
  if (request.members.some((member) => validateMemberNameInline(member.name.trim()) !== null)) {
    return {
      valid: false,
      errors: {
        members: t('create.validation.memberNameInvalid'),
      },
    };
  }
  const uniqueNames = new Set(request.members.map((member) => member.name.trim().toLowerCase()));
  if (uniqueNames.size !== request.members.length) {
    return {
      valid: false,
      errors: {
        members: t('create.validation.memberNamesUnique'),
      },
    };
  }
  return { valid: true };
}

export const CreateTeamDialog = ({
  open,
  canCreate,
  provisioningErrorsByTeam,
  clearProvisioningError,
  existingTeamNames,
  provisioningTeamNames = [],
  initialData,
  initialOrganizationPlacement,
  onClose,
  onLaunchAfterCreate,
  onOpenTeam,
}: CreateTeamDialogProps): React.JSX.Element => {
  const { isLight } = useTheme();
  const { t } = useAppTranslation('team');
  const multimodelEnabled = useStore((s) => s.appConfig?.general?.multimodelEnabled ?? true);
  const anthropicProviderFastModeDefault = useStore(
    (s) => s.appConfig?.providerConnections?.anthropic.fastModeDefault ?? false
  );
  const { cliStatus, cliStatusLoading, cliProviderStatusLoading } = useStore(
    useShallow((s) => ({
      cliStatus: s.cliStatus,
      cliStatusLoading: s.cliStatusLoading,
      cliProviderStatusLoading: s.cliProviderStatusLoading,
    }))
  );
  const bootstrapCliStatus = useStore((s) => s.bootstrapCliStatus);
  const fetchCliStatus = useStore((s) => s.fetchCliStatus);
  const openDashboard = useStore((s) => s.openDashboard);
  const loadingCliStatus = useMemo(
    () =>
      !cliStatus && cliStatusLoading && multimodelEnabled
        ? createLoadingMultimodelCliStatus()
        : cliStatus,
    [cliStatus, cliStatusLoading, multimodelEnabled]
  );
  // The codex account snapshot is flavor-independent (app-server based); the
  // stock flavor also surfaces a codex provider entry for codex lane teams.
  const codexAccount = useCodexAccountSnapshot({
    enabled:
      multimodelEnabled &&
      Boolean(loadingCliStatus?.providers.some((provider) => provider.providerId === 'codex')),
  });
  const effectiveCliStatus = useMemo(
    () => mergeCodexCliStatusWithSnapshot(loadingCliStatus, codexAccount.snapshot),
    [loadingCliStatus, codexAccount.snapshot]
  );
  const codexSnapshotPending =
    isCodexAccountSnapshotPending(
      codexAccount.loading,
      codexAccount.snapshot,
      codexAccount.error
    ) && Boolean(loadingCliStatus?.providers.some((provider) => provider.providerId === 'codex'));
  const globalRuntimeProviderStatusById = useMemo(
    () =>
      new Map(
        (effectiveCliStatus?.providers ?? []).map(
          (provider) => [provider.providerId, provider] as const
        )
      ),
    [effectiveCliStatus?.providers]
  );

  // ── Persisted draft state (survives tab navigation) ──────────────────
  const {
    teamName,
    setTeamName,
    members,
    setMembers,
    syncModelsWithLead,
    setSyncModelsWithLead,
    teammateWorktreeDefault,
    setTeammateWorktreeDefault,
    soloTeam,
    setSoloTeam,
    launchTeam,
    setLaunchTeam,
    teamColor,
    setTeamColor,
    isLoaded: draftLoaded,
    clearDraft,
  } = useCreateTeamDraft();

  const descriptionDraft = useDraftPersistence({ key: 'createTeam:description' });
  const promptDraft = useDraftPersistence({ key: 'createTeam:prompt' });
  const promptChipDraft = useChipDraftPersistence('createTeam:prompt:chips');

  // ── Transient UI state (NOT persisted) ───────────────────────────────
  const [localError, setLocalError] = useState<string | null>(null);
  const [workflowMentionSuggestionsEnabled, setWorkflowMentionSuggestionsEnabled] = useState(false);
  const lastAutoDescriptionRef = useRef<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    teamName?: string;
    members?: string;
  }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittedTeamNameRef = useRef<string | null>(null);
  const [organizationStructure, setOrganizationStructure] =
    useState<OrganizationStructurePayload | null>(null);
  const [organizationStructureLoading, setOrganizationStructureLoading] = useState(false);
  const [organizationPlacementEnabled, setOrganizationPlacementEnabled] = useState(false);
  const [organizationPlacementOrganizationId, setOrganizationPlacementOrganizationId] =
    useState('');
  const [organizationPlacementParentId, setOrganizationPlacementParentId] = useState('');
  const [organizationPlacementError, setOrganizationPlacementError] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderIdRaw] = useState<TeamProviderId>(() =>
    normalizeLeadProviderForMode(getStoredTeamProvider(), multimodelEnabled)
  );
  const [selectedModel, setSelectedModelRaw] = useState(() =>
    getStoredTeamModel(normalizeLeadProviderForMode(getStoredTeamProvider(), multimodelEnabled))
  );
  const [limitContext, setLimitContextRaw] = useState(getStoredCreateTeamLimitContext);
  const [skipPermissions, setSkipPermissionsRaw] = useState(getStoredCreateTeamSkipPermissions);
  const [selectedEffort, setSelectedEffortRaw] = useState(getStoredCreateTeamEffort);
  const [selectedFastMode, setSelectedFastModeRaw] = useState<TeamFastMode>(getStoredTeamFastMode);
  const [anthropicRuntimeNotice, setAnthropicRuntimeNotice] = useState<string | null>(null);

  // Advanced CLI section state (use teamName-derived key for localStorage)
  const advancedKey = useMemo(() => sanitizeTeamName(teamName.trim()) || '_new_', [teamName]);
  const [worktreeEnabled, setWorktreeEnabledRaw] = useState(false);
  const [worktreeName, setWorktreeNameRaw] = useState('');
  const [customArgs, setCustomArgsRaw] = useState('');

  useEffect(() => {
    migrateLegacyCreateTeamPreferences();
  }, []);

  useEffect(() => {
    if (!open) {
      setOrganizationPlacementEnabled(false);
      setOrganizationPlacementError(null);
      return undefined;
    }

    let cancelled = false;
    const preferredPlacement = initialOrganizationPlacement ?? null;
    setOrganizationStructureLoading(true);
    void api.organizations
      .getOrganizationStructure()
      .then((payload) => {
        if (cancelled) return;
        setOrganizationStructure(payload);
        const organization =
          (preferredPlacement
            ? payload.organizations.find(
                (candidate) => candidate.id === preferredPlacement.organizationId
              )
            : undefined) ??
          payload.organizations[0] ??
          null;
        setOrganizationPlacementEnabled(Boolean(preferredPlacement));
        setOrganizationPlacementOrganizationId(organization?.id ?? '');
        setOrganizationPlacementParentId(
          preferredPlacement?.parentUnitId ?? organization?.rootNodeId ?? ''
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setOrganizationPlacementError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) {
          setOrganizationStructureLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialOrganizationPlacement, open]);

  // Re-read localStorage when advancedKey changes
  useEffect(() => {
    const storedEnabled =
      localStorage.getItem(`team:lastWorktreeEnabled:${advancedKey}`) === 'true';
    const storedName = localStorage.getItem(`team:lastWorktreeName:${advancedKey}`) ?? '';
    setWorktreeEnabledRaw(storedEnabled && Boolean(storedName));
    setWorktreeNameRaw(storedName);
    setCustomArgsRaw(localStorage.getItem(`team:lastCustomArgs:${advancedKey}`) ?? '');
  }, [advancedKey]);

  const setLimitContext = useCallback((value: boolean): void => {
    setLimitContextRaw(value);
    setStoredCreateTeamLimitContext(value);
  }, []);

  const setSkipPermissions = useCallback((value: boolean): void => {
    setSkipPermissionsRaw(value);
    setStoredCreateTeamSkipPermissions(value);
  }, []);

  const setSelectedEffort = useCallback((value: string): void => {
    setSelectedEffortRaw(value);
    setStoredCreateTeamEffort(value);
  }, []);

  const setSelectedFastMode = useCallback((value: TeamFastMode): void => {
    setSelectedFastModeRaw(value);
    setStoredCreateTeamFastMode(value);
  }, []);
  const enableWorkflowMentionSuggestions = useCallback((): void => {
    setWorkflowMentionSuggestionsEnabled(true);
  }, []);

  const setWorktreeEnabled = (value: boolean): void => {
    setWorktreeEnabledRaw(value);
    localStorage.setItem(`team:lastWorktreeEnabled:${advancedKey}`, String(value));
    if (!value) {
      setWorktreeNameRaw('');
      localStorage.setItem(`team:lastWorktreeName:${advancedKey}`, '');
    }
  };
  const setWorktreeName = (value: string): void => {
    setWorktreeNameRaw(value);
    localStorage.setItem(`team:lastWorktreeName:${advancedKey}`, value);
  };
  const setCustomArgs = (value: string): void => {
    setCustomArgsRaw(value);
    localStorage.setItem(`team:lastCustomArgs:${advancedKey}`, value);
  };

  const resetUIState = (): void => {
    submittedTeamNameRef.current = null;
    setLocalError(null);
    setFieldErrors({});
    setIsSubmitting(false);
  };

  const resetFormState = (): void => {
    clearDraft();
    lastAutoDescriptionRef.current = null;
    descriptionDraft.clearDraft();
    promptDraft.clearDraft();
    promptChipDraft.clearChipDraft();
    resetUIState();
  };

  const persistCurrentMemberRuntimePreferences = useCallback(
    (nextMembers: readonly MemberDraft[] = members): void => {
      setStoredCreateTeamMemberRuntimePreferences(nextMembers);
    },
    [members]
  );

  // The project folder is chosen at launch time (LaunchTeamDialog); creation is
  // folder-independent, so only the global runtime provider status applies here.
  const runtimeProviderStatusById = globalRuntimeProviderStatusById;
  const memberModelNormalizationDeferredProviderIds = useMemo<ReadonlySet<TeamProviderId>>(
    () => (codexSnapshotPending ? new Set<TeamProviderId>(['codex']) : new Set()),
    [codexSnapshotPending]
  );
  const dialogTeamNameKey = sanitizeTeamName(teamName.trim());
  /** All taken names: existing teams + teams currently being provisioned. */
  const allTakenTeamNames = useMemo(
    () => [...new Set([...existingTeamNames, ...provisioningTeamNames])],
    [existingTeamNames, provisioningTeamNames]
  );
  const suggestedTeamName = useMemo(
    () => getNextSuggestedTeamName(allTakenTeamNames),
    [allTakenTeamNames]
  );

  // Clear stale provisioning error when dialog opens
  useEffect(() => {
    if (open && dialogTeamNameKey) {
      clearProvisioningError?.(dialogTeamNameKey);
    }
  }, [open, clearProvisioningError, dialogTeamNameKey]);

  const effectiveMemberDrafts = useMemo(() => {
    const scopedMembers = syncModelsWithLead ? members.map(clearMemberModelOverrides) : members;
    return clearInheritedMemberModelsUnavailableForProvider({
      members: scopedMembers,
      selectedProviderId,
      runtimeProviderStatusById,
      deferredProviderIds: memberModelNormalizationDeferredProviderIds,
    }).members;
  }, [
    memberModelNormalizationDeferredProviderIds,
    members,
    runtimeProviderStatusById,
    selectedProviderId,
    syncModelsWithLead,
  ]);
  const tmuxRuntime = useTmuxRuntimeReadiness(open && canCreate);

  const selectedMemberProviders = useMemo<TeamProviderId[]>(() => {
    if (!multimodelEnabled) {
      return ['anthropic'];
    }
    if (soloTeam || syncModelsWithLead) {
      return [selectedProviderId];
    }
    return Array.from(
      new Set([
        selectedProviderId,
        ...members.flatMap((member) =>
          !member.removedAt && isTeamProviderId(member.providerId) ? [member.providerId] : []
        ),
      ])
    );
  }, [members, multimodelEnabled, selectedProviderId, soloTeam, syncModelsWithLead]);
  const { requiredCatalogPending: openCodeCatalogPending } = useOpenCodeCatalogPrefetch({
    enabled: open && multimodelEnabled,
    projectPath: null,
    priority: selectedMemberProviders.includes('opencode') ? 'required' : 'background',
    deferBackground: isSubmitting,
  });
  const hasSelectedAnthropicRuntime = selectedMemberProviders.includes('anthropic');
  const effectiveAnthropicRuntimeLimitContext = hasSelectedAnthropicRuntime ? limitContext : false;

  const setSelectedModel = useCallback(
    (value: string): void => {
      const normalizedValue = normalizeExplicitTeamModelForUi(selectedProviderId, value);
      const nextEffort = getAvailableTeamEffortValue({
        providerId: selectedProviderId,
        model: normalizedValue,
        limitContext: effectiveAnthropicRuntimeLimitContext,
        providerStatus: runtimeProviderStatusById.get(selectedProviderId),
        value: selectedEffort,
      });
      setSelectedModelRaw(normalizedValue);
      setStoredCreateTeamModel(selectedProviderId, normalizedValue);
      if (nextEffort !== selectedEffort) {
        setSelectedEffortRaw(nextEffort);
        setStoredCreateTeamEffort(nextEffort);
      }
    },
    [
      effectiveAnthropicRuntimeLimitContext,
      runtimeProviderStatusById,
      selectedEffort,
      selectedProviderId,
    ]
  );

  const setSelectedProviderId = useCallback(
    (value: TeamProviderId): void => {
      const normalizedValue = normalizeLeadProviderForMode(value, multimodelEnabled);
      const nextModel = getStoredTeamModel(normalizedValue);
      const nextEffort = getAvailableTeamEffortValue({
        providerId: normalizedValue,
        model: nextModel,
        limitContext: normalizedValue === 'anthropic' ? limitContext : false,
        providerStatus: runtimeProviderStatusById.get(normalizedValue),
        value: selectedEffort,
      });
      setSelectedProviderIdRaw(normalizedValue);
      setStoredCreateTeamProvider(normalizedValue);
      setSelectedModelRaw(nextModel);
      if (nextEffort !== selectedEffort) {
        setSelectedEffortRaw(nextEffort);
        setStoredCreateTeamEffort(nextEffort);
      }
    },
    [limitContext, multimodelEnabled, runtimeProviderStatusById, selectedEffort]
  );

  const runtimeProviderLoadingById = useMemo(
    () =>
      new Map(
        selectedMemberProviders.map(
          (providerId) =>
            [
              providerId,
              isTeamProviderRuntimeStatusLoading(
                providerId,
                runtimeProviderStatusById.get(providerId),
                cliProviderStatusLoading[providerId] === true ||
                  (providerId === 'codex' && codexSnapshotPending)
              ) ||
                (providerId === 'opencode' && openCodeCatalogPending),
            ] as const
        )
      ),
    [
      cliProviderStatusLoading,
      codexSnapshotPending,
      openCodeCatalogPending,
      runtimeProviderStatusById,
      selectedMemberProviders,
    ]
  );
  const selectedProviderBackendId = useMemo(
    () =>
      resolveUiOwnedProviderBackendId(
        selectedProviderId,
        runtimeProviderStatusById.get(selectedProviderId)
      ),
    [runtimeProviderStatusById, selectedProviderId]
  );
  useEffect(() => {
    const sanitized = clearInheritedMemberModelsUnavailableForProvider({
      members,
      selectedProviderId,
      runtimeProviderStatusById,
      deferredProviderIds: memberModelNormalizationDeferredProviderIds,
    });
    if (sanitized.changed) {
      setMembers(sanitized.members);
    }
  }, [
    memberModelNormalizationDeferredProviderIds,
    members,
    runtimeProviderStatusById,
    selectedProviderId,
    setMembers,
  ]);

  const selectedEffortForCurrentSelection = useMemo(
    () =>
      getAvailableTeamEffortValue({
        providerId: selectedProviderId,
        model: selectedModel,
        limitContext: effectiveAnthropicRuntimeLimitContext,
        providerStatus: runtimeProviderStatusById.get(selectedProviderId),
        value: selectedEffort,
      }),
    [
      effectiveAnthropicRuntimeLimitContext,
      runtimeProviderStatusById,
      selectedEffort,
      selectedModel,
      selectedProviderId,
    ]
  );

  useEffect(() => {
    if (multimodelEnabled) {
      return;
    }
    if (selectedProviderId !== 'anthropic') {
      setSelectedProviderIdRaw('anthropic');
      setSelectedModelRaw(getStoredTeamModel('anthropic'));
    }
    const nextMembers = members.map((member) => normalizeMemberDraftForProviderMode(member, false));
    const changed = nextMembers.some((member, index) => member !== members[index]);
    if (changed) {
      setMembers(nextMembers);
    }
  }, [members, multimodelEnabled, selectedProviderId, setMembers]);

  useEffect(() => {
    if (!open || cliStatus || cliStatusLoading) {
      return;
    }
    void refreshCliStatusForCurrentMode({
      multimodelEnabled,
      bootstrapCliStatus,
      fetchCliStatus,
    });
  }, [bootstrapCliStatus, cliStatus, cliStatusLoading, fetchCliStatus, multimodelEnabled, open]);

  useEffect(() => {
    if (!open) {
      setWorkflowMentionSuggestionsEnabled(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !draftLoaded) {
      return;
    }

    if (initialData) {
      const nextSyncModelsWithLead = !initialData.members.some(
        (member) =>
          member.providerId ||
          member.providerBackendId ||
          member.model ||
          member.effort ||
          member.fastMode
      );
      const copiedProviderId =
        initialData.providerId == null
          ? selectedProviderId
          : normalizeLeadProviderForMode(initialData.providerId, multimodelEnabled);
      setTeamName(initialData.teamName);
      descriptionDraft.setValue(initialData.description ?? '');
      promptDraft.setValue(initialData.prompt ?? '');
      setTeamColor(initialData.color ?? '');
      if (Object.hasOwn(initialData, 'providerId')) {
        setSelectedProviderIdRaw(copiedProviderId);
      }
      if (Object.hasOwn(initialData, 'model')) {
        setSelectedModelRaw(normalizeExplicitTeamModelForUi(copiedProviderId, initialData.model));
      }
      if (Object.hasOwn(initialData, 'effort')) {
        setSelectedEffortRaw(initialData.effort ?? '');
      }
      if (Object.hasOwn(initialData, 'fastMode')) {
        setSelectedFastModeRaw(initialData.fastMode ?? 'inherit');
      }
      if (Object.hasOwn(initialData, 'limitContext')) {
        setLimitContextRaw(initialData.limitContext === true);
      }
      if (Object.hasOwn(initialData, 'skipPermissions')) {
        setSkipPermissionsRaw(initialData.skipPermissions !== false);
      }
      setMembers(
        initialData.members.map((m) => {
          const presetRoles: readonly string[] = PRESET_ROLES;
          const isPreset = m.role != null && presetRoles.includes(m.role);
          const isCustom = m.role != null && m.role.length > 0 && !isPreset;
          return normalizeMemberDraftForProviderMode(
            createMemberDraft({
              name: m.name,
              roleSelection: isCustom ? CUSTOM_ROLE : (m.role ?? ''),
              customRole: isCustom ? m.role : '',
              workflow: m.workflow,
              isolation: m.isolation === 'worktree' ? 'worktree' : undefined,
              providerId: normalizeOptionalTeamProviderId(m.providerId),
              providerBackendId: m.providerBackendId,
              model: m.model ?? '',
              effort: m.effort,
              fastMode: m.fastMode,
              mcpPolicy: m.mcpPolicy,
            }),
            multimodelEnabled
          );
        })
      );
      setTeammateWorktreeDefault(
        initialData.members.length > 0 &&
          initialData.members.every((member) => member.isolation === 'worktree')
      );
      setSyncModelsWithLead(nextSyncModelsWithLead, { persistStoredPreference: false });
      return;
    }

    if (members.length > 0) {
      return;
    }

    const nextDefaultMembers = DEFAULT_MEMBERS.map((member) =>
      createMemberDraft({
        name: member.name,
        roleSelection: member.roleSelection,
        workflow:
          member.workflowKind === 'reviewer' ? t('create.defaultWorkflows.reviewer') : undefined,
      })
    );
    setMembers(
      syncModelsWithLead
        ? nextDefaultMembers
        : applyStoredCreateTeamMemberRuntimePreferences(nextDefaultMembers)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialData is checked once on open/draftLoaded
  }, [open, draftLoaded, t]);

  useEffect(() => {
    if (!open || !draftLoaded || initialData || syncModelsWithLead || members.length === 0) {
      return;
    }
    persistCurrentMemberRuntimePreferences(members);
  }, [
    draftLoaded,
    initialData,
    members,
    open,
    persistCurrentMemberRuntimePreferences,
    syncModelsWithLead,
  ]);

  useEffect(() => {
    if (!open || initialData || !draftLoaded) {
      return;
    }
    if (teamName.trim().length === 0) {
      setTeamName(suggestedTeamName);
    }
  }, [initialData, open, suggestedTeamName, draftLoaded]); // eslint-disable-line react-hooks/exhaustive-deps -- teamName read once

  useEffect(() => {
    if (!open || initialData) {
      return;
    }
    const resolvedTeamName = teamName.trim() || suggestedTeamName;
    const nextAutoDescription = buildDefaultTeamDescription(resolvedTeamName, t);
    const currentDescription = descriptionDraft.value.trim();
    const previousAutoDescription = lastAutoDescriptionRef.current?.trim() ?? '';
    const shouldSyncDescription =
      currentDescription.length === 0 || currentDescription === previousAutoDescription;

    if (shouldSyncDescription && descriptionDraft.value !== nextAutoDescription) {
      lastAutoDescriptionRef.current = nextAutoDescription;
      descriptionDraft.setValue(nextAutoDescription);
      return;
    }

    if (currentDescription === nextAutoDescription) {
      lastAutoDescriptionRef.current = nextAutoDescription;
    }
  }, [descriptionDraft, initialData, open, suggestedTeamName, t, teamName]);

  const { suggestions: taskSuggestions } = useTaskSuggestions(null, {
    enabled: workflowMentionSuggestionsEnabled,
  });
  const { suggestions: teamMentionSuggestions } = useTeamSuggestions(null, {
    enabled: workflowMentionSuggestionsEnabled,
  });

  const description = descriptionDraft.value;
  const prompt = promptDraft.value;
  const memberColorMap = useMemo(() => buildMemberDraftColorMap(members), [members]);

  const mentionSuggestions = useMemo(
    () =>
      soloTeam
        ? [
            {
              id: 'team-lead',
              name: 'team-lead',
              subtitle: t('editTeam.teamLead.role'),
              color: resolveTeamLeadColorName(),
            },
          ]
        : buildMemberDraftSuggestions(members, memberColorMap),
    [memberColorMap, members, soloTeam, t]
  );

  const effectiveModel = useMemo(
    () =>
      computeEffectiveTeamModel(
        selectedModel,
        effectiveAnthropicRuntimeLimitContext,
        selectedProviderId,
        runtimeProviderStatusById.get(selectedProviderId)
      ),
    [
      effectiveAnthropicRuntimeLimitContext,
      runtimeProviderStatusById,
      selectedModel,
      selectedProviderId,
    ]
  );
  const teammateRuntimeCompatibility = useMemo(
    () =>
      analyzeTeammateRuntimeCompatibility({
        leadProviderId: selectedProviderId,
        leadProviderBackendId: selectedProviderBackendId,
        members: effectiveMemberDrafts,
        soloTeam: soloTeam || !canCreate,
        extraCliArgs: launchTeam ? customArgs : undefined,
        tmuxStatus: tmuxRuntime.status,
        tmuxStatusLoading: tmuxRuntime.loading,
        tmuxStatusError: tmuxRuntime.error,
      }),
    [
      customArgs,
      effectiveMemberDrafts,
      launchTeam,
      canCreate,
      selectedProviderBackendId,
      selectedProviderId,
      soloTeam,
      tmuxRuntime.error,
      tmuxRuntime.loading,
      tmuxRuntime.status,
    ]
  );
  const teammateRuntimeProviderNoticeById:
    | Partial<Record<TeamProviderId, React.ReactNode>>
    | undefined = teammateRuntimeCompatibility.providerNoticeProviderId
    ? {
        [teammateRuntimeCompatibility.providerNoticeProviderId]: (
          <TeammateRuntimeCompatibilityNotice
            analysis={teammateRuntimeCompatibility}
            onOpenDashboard={() => {
              onClose();
              openDashboard();
            }}
          />
        ),
      }
    : undefined;
  const showRosterTeammateRuntimeCompatibility =
    teammateRuntimeCompatibility.visible && !teammateRuntimeCompatibility.providerNoticeProviderId;
  const anthropicRuntimeSelection = useMemo(
    () =>
      selectedProviderId === 'anthropic'
        ? resolveAnthropicRuntimeSelection({
            source: {
              modelCatalog: runtimeProviderStatusById.get('anthropic')?.modelCatalog,
              runtimeCapabilities: runtimeProviderStatusById.get('anthropic')?.runtimeCapabilities,
            },
            selectedModel,
            limitContext: effectiveAnthropicRuntimeLimitContext,
          })
        : null,
    [
      effectiveAnthropicRuntimeLimitContext,
      runtimeProviderStatusById,
      selectedModel,
      selectedProviderId,
    ]
  );
  const anthropicFastModeResolution = useMemo(
    () =>
      selectedProviderId === 'anthropic' && anthropicRuntimeSelection
        ? resolveAnthropicFastMode({
            selection: anthropicRuntimeSelection,
            selectedFastMode,
            providerFastModeDefault: anthropicProviderFastModeDefault,
          })
        : null,
    [
      anthropicProviderFastModeDefault,
      anthropicRuntimeSelection,
      selectedFastMode,
      selectedProviderId,
    ]
  );
  const codexRuntimeSelection = useMemo(
    () =>
      selectedProviderId === 'codex'
        ? resolveCodexRuntimeSelection({
            source: {
              providerStatus: runtimeProviderStatusById.get('codex'),
              providerBackendId: resolveUiOwnedProviderBackendId(
                'codex',
                runtimeProviderStatusById.get('codex')
              ),
            },
            selectedModel,
          })
        : null,
    [runtimeProviderStatusById, selectedModel, selectedProviderId]
  );
  const codexFastModeResolution = useMemo(
    () =>
      selectedProviderId === 'codex' && codexRuntimeSelection
        ? resolveCodexFastMode({
            selection: codexRuntimeSelection,
            selectedFastMode,
          })
        : null,
    [codexRuntimeSelection, selectedFastMode, selectedProviderId]
  );

  useEffect(() => {
    if (selectedProviderId !== 'anthropic' && selectedProviderId !== 'codex') {
      setAnthropicRuntimeNotice(null);
      return;
    }
    if (selectedProviderId === 'codex' && codexSnapshotPending) {
      setAnthropicRuntimeNotice(null);
      return;
    }

    const reconciliation =
      selectedProviderId === 'anthropic'
        ? reconcileAnthropicRuntimeSelections({
            selection:
              anthropicRuntimeSelection ??
              resolveAnthropicRuntimeSelection({
                source: {
                  modelCatalog: null,
                  runtimeCapabilities: null,
                },
                selectedModel,
                limitContext: effectiveAnthropicRuntimeLimitContext,
              }),
            selectedEffort: selectedEffortForCurrentSelection,
            selectedFastMode,
            providerFastModeDefault: anthropicProviderFastModeDefault,
            runtimeCapabilities: runtimeProviderStatusById.get('anthropic')?.runtimeCapabilities,
          })
        : {
            nextEffort: selectedEffortForCurrentSelection,
            effortResetReason: null,
            ...reconcileCodexRuntimeSelections({
              selection:
                codexRuntimeSelection ??
                resolveCodexRuntimeSelection({
                  source: {
                    providerStatus: runtimeProviderStatusById.get('codex'),
                    providerBackendId: resolveUiOwnedProviderBackendId(
                      'codex',
                      runtimeProviderStatusById.get('codex')
                    ),
                  },
                  selectedModel,
                }),
              selectedFastMode,
            }),
          };

    const notices: string[] = [];
    if (selectedEffortForCurrentSelection !== selectedEffort) {
      setSelectedEffortRaw(selectedEffortForCurrentSelection);
      setStoredCreateTeamEffort(selectedEffortForCurrentSelection);
    }
    if (reconciliation.nextEffort !== selectedEffortForCurrentSelection) {
      setSelectedEffortRaw(reconciliation.nextEffort);
      setStoredCreateTeamEffort(reconciliation.nextEffort);
      if (reconciliation.effortResetReason) {
        notices.push(reconciliation.effortResetReason);
      }
    }
    if (reconciliation.nextFastMode !== selectedFastMode) {
      setSelectedFastModeRaw(reconciliation.nextFastMode);
      setStoredCreateTeamFastMode(reconciliation.nextFastMode);
      if (reconciliation.fastModeResetReason) {
        notices.push(reconciliation.fastModeResetReason);
      }
    }
    setAnthropicRuntimeNotice(notices.length > 0 ? notices.join(' ') : null);
  }, [
    anthropicProviderFastModeDefault,
    anthropicRuntimeSelection,
    codexRuntimeSelection,
    codexSnapshotPending,
    effectiveAnthropicRuntimeLimitContext,
    runtimeProviderStatusById,
    selectedEffort,
    selectedEffortForCurrentSelection,
    selectedFastMode,
    selectedModel,
    selectedProviderId,
  ]);

  const sanitizedTeamName = sanitizeTeamName(teamName.trim());
  const teamNameInlineError = validateTeamNameInline(teamName, t);
  const isSubmittedTeamName = submittedTeamNameRef.current === sanitizedTeamName;
  const isNameTakenByExistingTeam =
    !isSubmittedTeamName && existingTeamNames.includes(sanitizedTeamName);
  const isNameProvisioning =
    !isSubmittedTeamName &&
    provisioningTeamNames.includes(sanitizedTeamName) &&
    !isNameTakenByExistingTeam;

  const request = useMemo<TeamCreateRequest>(
    () => ({
      teamName: sanitizedTeamName,
      description: description.trim() || undefined,
      color: teamColor || undefined,
      members: soloTeam
        ? []
        : buildMembersFromDrafts(effectiveMemberDrafts, {
            inheritedProviderId: selectedProviderId,
          }),
      cwd: '',
      prompt: prompt.trim() || undefined,
      providerId: selectedProviderId,
      providerBackendId: selectedProviderBackendId ?? undefined,
      model: effectiveModel,
      effort: (selectedEffortForCurrentSelection as EffortLevel) || undefined,
      fastMode:
        selectedProviderId === 'anthropic' || selectedProviderId === 'codex'
          ? selectedFastMode
          : undefined,
      limitContext: effectiveAnthropicRuntimeLimitContext,
      skipPermissions,
      worktree: worktreeEnabled && worktreeName.trim() ? worktreeName.trim() : undefined,
      extraCliArgs: customArgs.trim() || undefined,
    }),
    [
      sanitizedTeamName,
      description,
      teamColor,
      soloTeam,
      effectiveMemberDrafts,
      prompt,
      selectedProviderId,
      selectedProviderBackendId,
      effectiveModel,
      selectedEffortForCurrentSelection,
      selectedFastMode,
      effectiveAnthropicRuntimeLimitContext,
      skipPermissions,
      worktreeEnabled,
      worktreeName,
      customArgs,
    ]
  );
  const requestValidation = useMemo(() => validateRequest(request, t), [request, t]);
  const modelValidationError = useMemo(() => {
    if (!runtimeProviderLoadingById.get(selectedProviderId)) {
      const leadError = getTeamModelSelectionError(
        selectedProviderId,
        selectedModel,
        runtimeProviderStatusById.get(selectedProviderId)
      );
      if (leadError) {
        return leadError;
      }
    }

    for (const member of effectiveMemberDrafts) {
      if (member.removedAt) {
        continue;
      }

      const providerId = normalizeOptionalTeamProviderId(member.providerId) ?? selectedProviderId;
      if (runtimeProviderLoadingById.get(providerId)) {
        continue;
      }
      const memberError = getTeamModelSelectionError(
        providerId,
        member.model,
        runtimeProviderStatusById.get(providerId)
      );
      if (!memberError) {
        continue;
      }

      const memberName = member.name.trim();
      return memberName ? `${memberName}: ${memberError}` : memberError;
    }

    return null;
  }, [
    effectiveMemberDrafts,
    runtimeProviderStatusById,
    runtimeProviderLoadingById,
    selectedModel,
    selectedProviderId,
  ]);
  const hasCreateFormErrors =
    !!teamNameInlineError ||
    isNameTakenByExistingTeam ||
    isNameProvisioning ||
    !requestValidation.valid ||
    !!modelValidationError ||
    teammateRuntimeCompatibility.blocksSubmission;

  const internalArgs = useMemo(() => {
    const args: string[] = [];
    args.push('--input-format', 'stream-json', '--output-format', 'stream-json');
    args.push('--verbose', '--setting-sources', 'user,project,local');
    args.push('--mcp-config', '<auto>', '--disallowedTools', APP_TEAM_RUNTIME_DISALLOWED_TOOLS);
    if (skipPermissions) args.push('--dangerously-skip-permissions');
    if (effectiveModel) args.push('--model', effectiveModel);
    const effectiveEffort =
      selectedProviderId === 'anthropic'
        ? selectedEffortForCurrentSelection || anthropicRuntimeSelection?.defaultEffort || ''
        : selectedEffortForCurrentSelection;
    if (effectiveEffort) args.push('--effort', effectiveEffort);
    if (selectedProviderId === 'anthropic') {
      const fastSettings = anthropicFastModeResolution?.resolvedFastMode
        ? { fastMode: true, fastModePerSessionOptIn: false }
        : { fastMode: false };
      args.push('--settings', JSON.stringify(fastSettings));
    } else if (selectedProviderId === 'codex') {
      args.push(...buildCodexFastModeArgs(codexFastModeResolution?.resolvedFastMode));
    }
    return args;
  }, [
    anthropicFastModeResolution?.resolvedFastMode,
    anthropicRuntimeSelection?.defaultEffort,
    codexFastModeResolution?.resolvedFastMode,
    effectiveModel,
    selectedEffortForCurrentSelection,
    selectedProviderId,
    skipPermissions,
  ]);

  const launchOptionalSummary = useMemo(() => {
    const summary: string[] = [];
    if (prompt.trim()) summary.push(t('create.optional.summary.leadPrompt'));
    if (skipPermissions) summary.push(t('create.optional.summary.autoApproveTools'));
    if (selectedProviderId === 'anthropic' || selectedProviderId === 'codex') {
      if (selectedFastMode === 'on') summary.push(t('create.optional.summary.fastMode'));
      else if (selectedFastMode === 'off') summary.push(t('create.optional.summary.fastDisabled'));
      else if (selectedProviderId === 'anthropic' && anthropicProviderFastModeDefault) {
        summary.push(t('create.optional.summary.fastDefault'));
      }
    }
    if (effectiveAnthropicRuntimeLimitContext) {
      summary.push(t('create.optional.summary.anthropicLimitedContext'));
    }
    if (worktreeEnabled && worktreeName.trim()) {
      summary.push(t('create.optional.summary.worktree', { name: worktreeName.trim() }));
    }
    if (customArgs.trim()) summary.push(t('create.optional.summary.customCliArgs'));
    return summary;
  }, [
    anthropicProviderFastModeDefault,
    customArgs,
    effectiveAnthropicRuntimeLimitContext,
    prompt,
    selectedFastMode,
    selectedProviderId,
    skipPermissions,
    t,
    worktreeEnabled,
    worktreeName,
  ]);

  const teamDetailsSummary = useMemo(() => {
    const summary: string[] = [];
    if (description.trim()) summary.push(t('create.optional.summary.description'));
    if (teamColor) summary.push(t('create.optional.summary.color', { color: teamColor }));
    return summary;
  }, [description, t, teamColor]);

  const handleSyncModelsWithLeadChange = useCallback(
    (checked: boolean): void => {
      setSyncModelsWithLead(checked);
      if (checked) {
        persistCurrentMemberRuntimePreferences(members);
        setMembers(members.map(clearMemberModelOverrides));
        return;
      }

      if (getStoredCreateTeamMemberRuntimePreferences().length === 0) {
        return;
      }

      const nextMembers = applyStoredCreateTeamMemberRuntimePreferences(members);
      const hasRuntimeChanges = nextMembers.some((member, index) => {
        const previousMember = members[index];
        return (
          member.providerId !== previousMember?.providerId ||
          member.model !== previousMember?.model ||
          member.effort !== previousMember?.effort
        );
      });
      if (hasRuntimeChanges) {
        setMembers(nextMembers);
      }
    },
    [members, persistCurrentMemberRuntimePreferences, setMembers, setSyncModelsWithLead]
  );

  const activeError =
    localError ?? modelValidationError ?? provisioningErrorsByTeam[request.teamName] ?? null;
  const canOpenExistingTeam =
    activeError?.includes('Team already exists') === true && request.teamName.length > 0;

  const organizationPlacementOrganizations = organizationStructure?.organizations ?? [];
  const activePlacementOrganization =
    organizationPlacementOrganizations.find(
      (organization) => organization.id === organizationPlacementOrganizationId
    ) ??
    organizationPlacementOrganizations[0] ??
    null;
  const organizationPlacementParentOptions = useMemo(
    () =>
      getOrganizationPlacementUnitOptions(
        organizationStructure,
        activePlacementOrganization?.id ?? ''
      ),
    [activePlacementOrganization?.id, organizationStructure]
  );
  const activePlacementParent =
    organizationPlacementParentOptions.find(
      (option) => option.unit.id === organizationPlacementParentId
    )?.unit ??
    organizationPlacementParentOptions[0]?.unit ??
    null;
  const selectedOrganizationPlacement = useMemo<OrganizationPlacementSelection | null>(() => {
    if (!organizationPlacementEnabled || !activePlacementOrganization || !activePlacementParent) {
      return null;
    }
    return {
      organizationId: activePlacementOrganization.id,
      parentUnitId: activePlacementParent.id,
    };
  }, [activePlacementOrganization, activePlacementParent, organizationPlacementEnabled]);
  const organizationPlacementSummary = selectedOrganizationPlacement
    ? [
        activePlacementOrganization?.name ?? selectedOrganizationPlacement.organizationId,
        activePlacementParent ? getOrganizationUnitLabel(activePlacementParent) : '',
      ].filter(Boolean)
    : [];

  const handleSubmit = (): void => {
    if (allTakenTeamNames.includes(sanitizedTeamName)) {
      const msg = isNameProvisioning
        ? t('create.validation.teamLaunching')
        : t('create.validation.teamNameExists');
      setFieldErrors({ teamName: msg });
      setLocalError(msg);
      return;
    }
    const validation = validateRequest(request, t);
    if (!validation.valid) {
      const errors = validation.errors ?? {};
      setFieldErrors(errors);
      const messages = Object.values(errors).filter(Boolean);
      setLocalError(messages.join(' · ') || t('create.validation.checkFormFields'));
      return;
    }
    if (modelValidationError) {
      setLocalError(modelValidationError);
      return;
    }
    if (teammateRuntimeCompatibility.blocksSubmission) {
      setLocalError(teammateRuntimeCompatibility.message);
      return;
    }
    setFieldErrors({});
    setLocalError(null);
    submittedTeamNameRef.current = request.teamName;
    setIsSubmitting(true);

    // Both paths create a draft; the project folder is chosen in the launch dialog.
    void (async () => {
      try {
        if (!syncModelsWithLead) {
          persistCurrentMemberRuntimePreferences(members);
        }
        await api.teams.createConfig({
          teamName: request.teamName,
          displayName: request.displayName,
          description: request.description,
          color: request.color,
          members: request.members,
          prompt: request.prompt,
          providerId: request.providerId,
          providerBackendId: request.providerBackendId,
          model: request.model,
          effort: request.effort,
          fastMode: request.fastMode,
          limitContext: request.limitContext,
          skipPermissions: request.skipPermissions,
          worktree: request.worktree,
          extraCliArgs: request.extraCliArgs,
        });
        if (selectedOrganizationPlacement) {
          try {
            await api.organizations.assignTeamToUnit({
              ...selectedOrganizationPlacement,
              teamName: request.teamName,
              label: request.displayName || request.teamName,
            });
          } catch (error) {
            console.warn('[Organizations] Failed to place created team in organization', error);
          }
        }
        if (launchTeam) {
          onLaunchAfterCreate?.(request.teamName);
        }
        onOpenTeam(request.teamName);
        resetFormState();
        onClose();
      } catch (error) {
        setLocalError(
          error instanceof Error ? error.message : t('create.errors.createConfigFailed')
        );
      } finally {
        submittedTeamNameRef.current = null;
        setIsSubmitting(false);
      }
    })();
  };

  const handleTeamNameChange = (value: string): void => {
    setTeamName(value);
    setFieldErrors((prev) => {
      if (!prev.teamName) return prev;
      // eslint-disable-next-line sonarjs/no-unused-vars -- destructured to omit teamName from rest
      const { teamName: _teamName, ...rest } = prev;
      const remaining = Object.values(rest).filter(Boolean);
      if (remaining.length === 0) {
        setLocalError(null);
      } else {
        setLocalError(remaining.join(' · '));
      }
      return rest;
    });
  };

  const rosterHeaderTop = useMemo(
    () => (
      <div className="flex items-center gap-2">
        <Checkbox
          id="solo-team"
          checked={soloTeam}
          onCheckedChange={(checked) => setSoloTeam(checked === true)}
        />
        <Label
          htmlFor="solo-team"
          className="cursor-pointer text-xs font-normal text-text-secondary"
        >
          {t('create.solo.label')}
        </Label>
      </div>
    ),
    [setSoloTeam, soloTeam, t]
  );

  const rosterHeaderBottom = useMemo(
    () =>
      showRosterTeammateRuntimeCompatibility || soloTeam ? (
        <div className="space-y-2">
          {showRosterTeammateRuntimeCompatibility ? (
            <TeammateRuntimeCompatibilityNotice
              analysis={teammateRuntimeCompatibility}
              onOpenDashboard={() => {
                onClose();
                openDashboard();
              }}
            />
          ) : null}
          {soloTeam ? (
            <div className="flex items-start gap-2 rounded-md border border-sky-500/20 bg-sky-500/5 px-3 py-2">
              <Info className="mt-0.5 size-3.5 shrink-0 text-sky-400" />
              <p className="text-[11px] leading-relaxed text-sky-300">
                {t('create.solo.description')}
              </p>
            </div>
          ) : null}
        </div>
      ) : null,
    [
      onClose,
      openDashboard,
      showRosterTeammateRuntimeCompatibility,
      soloTeam,
      teammateRuntimeCompatibility,
      t,
    ]
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetUIState();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-[52rem]">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {initialData ? t('create.title.copy') : t('create.title.create')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {initialData ? t('create.description.copy') : t('create.description.create')}
          </DialogDescription>
        </DialogHeader>

        {!canCreate ? (
          <p
            className="rounded border p-2 text-xs"
            style={{
              backgroundColor: 'var(--warning-bg)',
              borderColor: 'var(--warning-border)',
              color: 'var(--warning-text)',
            }}
          >
            {t('create.localOnly')}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="team-name">{t('create.fields.teamName')}</Label>
            <Input
              id="team-name"
              className={cn(
                'h-8 text-xs',
                (fieldErrors.teamName || teamNameInlineError || isNameTakenByExistingTeam) &&
                  'border-[var(--field-error-border)] bg-[var(--field-error-bg)] focus-visible:ring-[var(--field-error-border)]'
              )}
              value={teamName}
              onChange={(event) => handleTeamNameChange(event.target.value)}
              placeholder={suggestedTeamName}
            />
            {isNameTakenByExistingTeam ? (
              <p className="text-[11px]" style={{ color: 'var(--field-error-text)' }}>
                {t('create.errors.nameExists')}
              </p>
            ) : teamNameInlineError ? (
              <p className="text-[11px]" style={{ color: 'var(--field-error-text)' }}>
                {teamNameInlineError}
              </p>
            ) : isNameProvisioning ? (
              <p className="text-[11px]" style={{ color: 'var(--warning-text)' }}>
                {t('create.errors.nameLaunching')}
              </p>
            ) : fieldErrors.teamName ? (
              <p className="text-[11px]" style={{ color: 'var(--field-error-text)' }}>
                {fieldErrors.teamName}
              </p>
            ) : null}
            {sanitizedTeamName && sanitizedTeamName !== teamName.trim() ? (
              <p className="text-[11px] text-[var(--color-text-muted)]">
                {t('create.onDisk')} <span className="font-mono">{sanitizedTeamName}</span>
              </p>
            ) : null}
          </div>

          <div className="md:col-span-2">
            <TeamRosterEditorSection
              members={members}
              onMembersChange={setMembers}
              fieldError={fieldErrors.members}
              validateMemberName={validateMemberNameInline}
              showWorkflow
              showJsonEditor
              draftKeyPrefix="createTeam"
              projectPath={null}
              taskSuggestions={taskSuggestions}
              teamSuggestions={teamMentionSuggestions}
              onWorkflowSuggestionsNeeded={enableWorkflowMentionSuggestions}
              defaultProviderId={selectedProviderId}
              inheritedProviderId={selectedProviderId}
              inheritedModel={selectedModel}
              inheritedEffort={(selectedEffortForCurrentSelection as EffortLevel) || undefined}
              inheritModelSettingsByDefault
              lockProviderModel={syncModelsWithLead}
              forceInheritedModelSettings={syncModelsWithLead}
              modelLockReason={t('create.memberModelLockReason')}
              hideMembersContent={soloTeam}
              providerId={selectedProviderId}
              model={selectedModel}
              effort={(selectedEffortForCurrentSelection as EffortLevel) || undefined}
              limitContext={effectiveAnthropicRuntimeLimitContext}
              runtimeProviderStatusById={runtimeProviderStatusById}
              leadProviderNoticeById={teammateRuntimeProviderNoticeById}
              onProviderChange={setSelectedProviderId}
              onModelChange={setSelectedModel}
              onEffortChange={setSelectedEffort}
              onLimitContextChange={setLimitContext}
              syncModelsWithTeammates={syncModelsWithLead}
              onSyncModelsWithTeammatesChange={handleSyncModelsWithLeadChange}
              showWorktreeIsolationControls={!soloTeam}
              teammateWorktreeDefault={teammateWorktreeDefault}
              onTeammateWorktreeDefaultChange={setTeammateWorktreeDefault}
              disableGeminiOption={isGeminiUiFrozen()}
              memberWarningById={teammateRuntimeCompatibility.memberWarningById}
              headerTop={rosterHeaderTop}
              headerBottom={rosterHeaderBottom}
            />
          </div>

          <div
            className="rounded-lg border border-[var(--color-border-emphasis)] p-4 shadow-sm md:col-span-2"
            style={{
              backgroundColor: isLight
                ? 'color-mix(in srgb, var(--color-surface-overlay) 24%, white 76%)'
                : 'var(--color-surface-overlay)',
            }}
          >
            <div className="flex items-start gap-3">
              <Checkbox
                id="launch-team"
                className="mt-1 shrink-0"
                checked={launchTeam}
                onCheckedChange={(checked) => setLaunchTeam(checked === true)}
              />
              <div className="space-y-1">
                <Label htmlFor="launch-team" className="cursor-pointer text-sm font-semibold">
                  {t('create.launchAfterCreate.label')}
                </Label>
                <p
                  className="text-xs"
                  style={{
                    color: isLight
                      ? 'color-mix(in srgb, var(--color-text-muted) 54%, var(--color-text) 46%)'
                      : 'var(--color-text-muted)',
                  }}
                >
                  {t('create.launchAfterCreate.description')}
                </p>
              </div>
            </div>

            {launchTeam ? (
              <div className="mt-4 space-y-4">
                <OptionalSettingsSection
                  title={t('create.optional.launchSettingsTitle')}
                  description={t('create.optional.launchSettingsDescription')}
                  summary={launchOptionalSummary}
                  onOpenChange={(isOpen) => {
                    if (isOpen) {
                      enableWorkflowMentionSuggestions();
                    }
                  }}
                >
                  <div className="space-y-4">
                    {selectedProviderId === 'anthropic' ? (
                      <div className="space-y-2">
                        <AnthropicFastModeSelector
                          value={selectedFastMode}
                          onValueChange={setSelectedFastMode}
                          providerFastModeDefault={anthropicProviderFastModeDefault}
                          model={selectedModel}
                          limitContext={effectiveAnthropicRuntimeLimitContext}
                          id="create-fast-mode"
                        />
                        {anthropicRuntimeNotice ? (
                          <div className="bg-amber-500/8 flex items-start gap-2 rounded-md border border-amber-500/25 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
                            <Info className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
                            <p>{anthropicRuntimeNotice}</p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {selectedProviderId === 'codex' ? (
                      <div className="space-y-2">
                        <CodexFastModeSelector
                          value={selectedFastMode}
                          onValueChange={setSelectedFastMode}
                          model={selectedModel}
                          providerBackendId={
                            resolveUiOwnedProviderBackendId(
                              'codex',
                              runtimeProviderStatusById.get('codex')
                            ) ?? undefined
                          }
                          id="create-fast-mode"
                        />
                        {anthropicRuntimeNotice ? (
                          <div className="bg-amber-500/8 flex items-start gap-2 rounded-md border border-amber-500/25 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
                            <Info className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
                            <p>{anthropicRuntimeNotice}</p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="space-y-1.5">
                      <Label htmlFor="team-prompt" className="label-optional">
                        {t('create.fields.prompt')}
                      </Label>
                      <MentionableTextarea
                        id="team-prompt"
                        className="text-xs"
                        minRows={3}
                        maxRows={12}
                        value={prompt}
                        onValueChange={promptDraft.setValue}
                        suggestions={soloTeam ? [] : mentionSuggestions}
                        teamSuggestions={teamMentionSuggestions}
                        taskSuggestions={taskSuggestions}
                        projectPath={null}
                        chips={promptChipDraft.chips}
                        onChipRemove={promptChipDraft.removeChip}
                        onFileChipInsert={promptChipDraft.addChip}
                        placeholder={t('create.placeholders.prompt')}
                        footerRight={
                          promptDraft.isSaved ? (
                            <span className="text-[10px] text-[var(--color-text-muted)]">
                              {t('create.saved')}
                            </span>
                          ) : null
                        }
                      />
                    </div>

                    <SkipPermissionsCheckbox
                      id="create-skip-permissions"
                      checked={skipPermissions}
                      onCheckedChange={setSkipPermissions}
                    />

                    <AdvancedCliSection
                      teamName={advancedKey}
                      internalArgs={internalArgs}
                      worktreeEnabled={worktreeEnabled}
                      onWorktreeEnabledChange={setWorktreeEnabled}
                      worktreeName={worktreeName}
                      onWorktreeNameChange={setWorktreeName}
                      customArgs={customArgs}
                      onCustomArgsChange={setCustomArgs}
                    />
                  </div>
                </OptionalSettingsSection>
              </div>
            ) : null}
          </div>

          <div className="md:col-span-2">
            <OptionalSettingsSection
              title={t('create.organizationPlacement.title')}
              description={t('create.organizationPlacement.description')}
              summary={organizationPlacementSummary}
            >
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="organization-placement-enabled"
                    className="mt-1 shrink-0"
                    checked={organizationPlacementEnabled}
                    disabled={
                      organizationStructureLoading ||
                      organizationPlacementOrganizations.length === 0
                    }
                    onCheckedChange={(checked) => setOrganizationPlacementEnabled(checked === true)}
                  />
                  <div className="min-w-0 space-y-1">
                    <Label
                      htmlFor="organization-placement-enabled"
                      className="cursor-pointer text-sm font-semibold"
                    >
                      {t('create.organizationPlacement.addToOrganization')}
                    </Label>
                    {organizationPlacementError ? (
                      <p className="text-[11px]" style={{ color: 'var(--field-error-text)' }}>
                        {organizationPlacementError}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <div className="space-y-0.5">
                      <Label className="text-xs">
                        {t('create.organizationPlacement.organizationLabel')}
                      </Label>
                      <p className="text-[11px] text-[var(--color-text-muted)]">
                        {t('create.organizationPlacement.organizationHelp')}
                      </p>
                    </div>
                    <Select
                      value={activePlacementOrganization?.id ?? ''}
                      disabled={
                        !organizationPlacementEnabled ||
                        organizationPlacementOrganizations.length === 0
                      }
                      onValueChange={(value) => {
                        setOrganizationPlacementOrganizationId(value);
                        const organization = organizationPlacementOrganizations.find(
                          (candidate) => candidate.id === value
                        );
                        setOrganizationPlacementParentId(organization?.rootNodeId ?? '');
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue
                          placeholder={t('create.organizationPlacement.organizationPlaceholder')}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {organizationPlacementOrganizations.map((organization) => (
                          <SelectItem key={organization.id} value={organization.id}>
                            {organization.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <div className="space-y-0.5">
                      <Label className="text-xs">
                        {t('create.organizationPlacement.groupOrRootLabel')}
                      </Label>
                      <p className="text-[11px] text-[var(--color-text-muted)]">
                        {t('create.organizationPlacement.groupOrRootHelp')}
                      </p>
                    </div>
                    <Select
                      value={activePlacementParent?.id ?? ''}
                      disabled={
                        !organizationPlacementEnabled ||
                        organizationPlacementParentOptions.length === 0
                      }
                      onValueChange={setOrganizationPlacementParentId}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue
                          placeholder={t('create.organizationPlacement.groupOrRootPlaceholder')}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {organizationPlacementParentOptions.map((option) => (
                          <SelectItem key={option.unit.id} value={option.unit.id}>
                            <span
                              className="flex min-w-0 items-center gap-2"
                              style={{ paddingLeft: `${Math.min(option.depth, 6) * 12}px` }}
                            >
                              <span className="truncate">
                                {getOrganizationUnitLabel(option.unit)}
                              </span>
                              <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                                {t(getOrganizationPlacementUnitKindKey(option.unit))}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </OptionalSettingsSection>
          </div>

          <div className="md:col-span-2">
            <OptionalSettingsSection
              title={t('create.optional.teamDetailsTitle')}
              description={t('create.optional.teamDetailsDescription')}
              summary={teamDetailsSummary}
            >
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="team-description" className="label-optional">
                    {t('create.fields.description')}
                  </Label>
                  <AutoResizeTextarea
                    id="team-description"
                    className="text-xs"
                    minRows={2}
                    maxRows={8}
                    value={description}
                    onChange={(event) => descriptionDraft.setValue(event.target.value)}
                    placeholder={t('create.placeholders.description')}
                  />
                  {descriptionDraft.isSaved ? (
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      {t('create.saved')}
                    </span>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label className="label-optional">{t('create.fields.color')}</Label>
                  <div className="flex flex-wrap gap-2">
                    {TEAM_COLOR_NAMES.map((colorName) => {
                      const colorSet = getTeamColorSet(colorName);
                      const isSelected = teamColor === colorName;
                      return (
                        <button
                          key={colorName}
                          type="button"
                          className={cn(
                            'flex size-7 items-center justify-center rounded-full border-2 transition-all',
                            isSelected ? 'scale-110' : 'opacity-70 hover:opacity-100'
                          )}
                          style={{
                            backgroundColor: getThemedBadge(colorSet, isLight),
                            borderColor: isSelected ? colorSet.border : 'transparent',
                          }}
                          title={colorName}
                          onClick={() => setTeamColor(isSelected ? '' : colorName)}
                        >
                          <span
                            className="size-3.5 rounded-full"
                            style={{ backgroundColor: colorSet.border }}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </OptionalSettingsSection>
          </div>
        </div>

        {activeError ? (
          <p
            className="rounded border p-2 text-xs"
            style={{
              color: 'var(--field-error-text)',
              borderColor: 'var(--field-error-border)',
              backgroundColor: 'var(--field-error-bg)',
            }}
          >
            {activeError}
          </p>
        ) : null}

        <DialogFooter className="pt-4 sm:justify-between">
          <div className="min-w-0">
            {canCreate && launchTeam ? (
              <ProviderActivityStatusStrip
                cliStatus={effectiveCliStatus}
                sourceCliStatus={loadingCliStatus}
                cliStatusLoading={cliStatusLoading}
                cliProviderStatusLoading={cliProviderStatusLoading}
                multimodelEnabled={multimodelEnabled}
                codexSnapshotPending={codexSnapshotPending}
                providerIds={selectedMemberProviders}
                className="mb-2"
                label={t('create.prepare.selectedProvidersLabel')}
                layout="stacked"
                showReadyProviders
                readyStatusText={t('create.prepare.readyStatus')}
              />
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {canOpenExistingTeam ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onOpenTeam(request.teamName);
                  onClose();
                }}
              >
                {t('create.actions.openExisting')}
              </Button>
            ) : null}
            <Button
              size="lg"
              className="min-w-32 text-sm"
              disabled={!canCreate || !draftLoaded || isSubmitting || hasCreateFormErrors}
              onClick={handleSubmit}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  {t('create.actions.creating')}
                </>
              ) : (
                t('create.actions.create')
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
