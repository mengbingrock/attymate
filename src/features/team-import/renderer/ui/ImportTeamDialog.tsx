import { useAppTranslation } from '@features/localization/renderer';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { FolderOpen, Globe, Loader2, Sparkles, X } from 'lucide-react';

import { validateTeamImportName } from '../../core/domain/teamImportPolicy';
import { useTeamImportDialog } from '../hooks/useTeamImportDialog';

import type { TeamImportNameValidationCode } from '../../core/domain/teamImportPolicy';
import type { TeamImportJobProgress, TeamImportWarning } from '@features/team-import/contracts';

interface ImportTeamDialogProps {
  open: boolean;
  onClose: () => void;
  onImported: (teamName: string, applyWarnings?: string[]) => void;
}

export const ImportTeamDialog = ({
  open,
  onClose,
  onImported,
}: ImportTeamDialogProps): React.JSX.Element => {
  const { t } = useAppTranslation('team');
  const formatNameValidation = (code: TeamImportNameValidationCode): string => {
    switch (code) {
      case 'teamNameRequired':
        return t('teamImport.teamNameRequired');
      case 'teamNameReserved':
        return t('teamImport.teamNameReserved');
      case 'teamNameInvalidFormat':
        return t('teamImport.invalidTeamName');
    }
  };
  const formatWarning = (warning: TeamImportWarning): string => {
    switch (warning.code) {
      case 'unsafeTaskCall':
        return t('teamImport.warningUnsafeTaskCall', { call: warning.call });
      case 'unknownTaskOwner':
        return t('teamImport.warningUnknownTaskOwner', {
          description: warning.description,
          owner: warning.owner,
        });
      case 'memberReserved':
        return t('teamImport.warningMemberReserved', warning);
      case 'memberInvalid':
        return t('teamImport.warningMemberInvalid', warning);
      case 'memberReservedSuffix':
        return t('teamImport.warningMemberReservedSuffix', warning);
      case 'duplicateMember':
        return t('teamImport.warningDuplicateMember', warning);
      case 'missingClaudeMd':
        return t('teamImport.warningMissingClaudeMd');
      case 'bundleMemberDropped':
        return t('teamImport.warningBundleMemberDropped', warning);
      case 'bundleSkillDropped':
        return t('teamImport.warningBundleSkillDropped', warning);
      case 'bundleFileDropped':
        return t('teamImport.warningBundleFileDropped', warning);
      case 'bundleSourceTruncated':
        return t('teamImport.warningBundleSourceTruncated');
    }
  };
  const formatElapsed = (elapsedSeconds: number): string => {
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
  };
  const formatStage = (progress: TeamImportJobProgress): string => {
    const label = (() => {
      switch (progress.stage) {
        case 'reading':
          return t('teamImport.stageReading');
        case 'fetching':
          return t('teamImport.stageFetching');
        case 'parsing':
          return t('teamImport.stageParsing');
        case 'validating':
          return t('teamImport.stageValidating');
      }
    })();
    const details: string[] = [];
    if (progress.elapsedSeconds !== undefined) details.push(formatElapsed(progress.elapsedSeconds));
    if (progress.receivedChars) {
      details.push(
        t('teamImport.stageReceivedChars', { chars: progress.receivedChars.toLocaleString() })
      );
    }
    return details.length > 0 ? `${label} (${details.join(' · ')})` : label;
  };
  const state = useTeamImportDialog({
    open,
    onClose,
    onImported,
    inspectErrorFallback: t('teamImport.inspectFailed'),
    createErrorFallback: t('teamImport.createFailed'),
    resolveValidationError: (code) => {
      if (
        code === 'teamNameRequired' ||
        code === 'teamNameInvalidFormat' ||
        code === 'teamNameReserved'
      ) {
        return formatNameValidation(code);
      }
      if (code === 'invalidUrl') return t('teamImport.invalidUrl');
      return null;
    },
  });
  const teamNameError = validateTeamImportName(state.teamName);
  const canCreate =
    state.preview !== null &&
    state.preview.blockingErrors.length === 0 &&
    teamNameError === null &&
    !state.importing;
  const offerSmartRetry =
    state.preview !== null &&
    state.preview.importKind === 'deterministic' &&
    state.preview.members.length === 0 &&
    !state.loading;
  const memberDetailByName = new Map(
    (state.preview?.memberDetails ?? []).map((detail) => [detail.name, detail])
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !state.importing && onClose()}>
      <DialogContent
        className="gap-0 overflow-hidden p-0"
        onEscapeKeyDown={(event) => state.importing && event.preventDefault()}
        onInteractOutside={(event) => state.importing && event.preventDefault()}
      >
        <div className="flex max-h-[85vh] min-h-0 flex-col">
          <DialogHeader className="border-b border-border px-6 py-5">
            <DialogTitle>{t('teamImport.title')}</DialogTitle>
            <DialogDescription>{t('teamImport.description')}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="space-y-4">
              <div className="flex items-center gap-1 rounded-md border border-border p-1 text-sm">
                <button
                  type="button"
                  className={`flex-1 rounded px-3 py-1.5 ${state.sourceKind === 'folder' ? 'bg-surface-hover font-medium text-text' : 'text-text-muted'}`}
                  onClick={() => state.setSourceKind('folder')}
                  disabled={state.loading || state.importing}
                >
                  <FolderOpen className="mr-1.5 inline size-3.5" />
                  {t('teamImport.sourceFolder')}
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded px-3 py-1.5 ${state.sourceKind === 'url' ? 'bg-surface-hover font-medium text-text' : 'text-text-muted'}`}
                  onClick={() => state.setSourceKind('url')}
                  disabled={state.loading || state.importing}
                >
                  <Globe className="mr-1.5 inline size-3.5" />
                  {t('teamImport.sourceUrl')}
                </button>
              </div>

              {state.sourceKind === 'folder' ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    onClick={() => void state.chooseFolder()}
                    disabled={state.loading || state.importing}
                  >
                    <FolderOpen className="mr-1.5 size-3.5" />
                    {state.loading ? t('teamImport.scanning') : t('teamImport.chooseFolder')}
                  </Button>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-text-muted">
                    <input
                      type="checkbox"
                      checked={state.smart}
                      onChange={(event) => state.setSmart(event.target.checked)}
                      disabled={state.loading || state.importing}
                    />
                    <Sparkles className="size-3.5" />
                    {t('teamImport.smartParse')}
                  </label>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    className="min-w-64 flex-1"
                    placeholder={t('teamImport.urlPlaceholder')}
                    value={state.url}
                    onChange={(event) => state.setUrl(event.target.value)}
                    disabled={state.loading || state.importing}
                  />
                  <Button
                    variant="outline"
                    onClick={() => void state.previewUrl()}
                    disabled={!state.url.trim() || state.loading || state.importing}
                  >
                    <Sparkles className="mr-1.5 size-3.5" />
                    {state.loading ? t('teamImport.scanning') : t('teamImport.fetchUrl')}
                  </Button>
                </div>
              )}

              {state.sourceKind === 'folder' && state.smart ? (
                <p className="text-xs text-text-muted">{t('teamImport.smartParseHint')}</p>
              ) : null}

              {state.loading && state.stage ? (
                <div className="flex items-center gap-2 text-sm text-text-muted" role="status">
                  <Loader2 className="size-4 animate-spin" />
                  {formatStage(state.stage)}
                </div>
              ) : null}

              {offerSmartRetry ? (
                <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                  <p className="text-sm text-text-muted">{t('teamImport.smartRetryPrompt')}</p>
                  <Button variant="outline" onClick={() => void state.retrySmart()}>
                    <Sparkles className="mr-1.5 size-3.5" />
                    {t('teamImport.smartRetryAction')}
                  </Button>
                </div>
              ) : null}

              {state.preview ? (
                <div className="space-y-4 rounded-md border border-border p-4">
                  <div className="space-y-2">
                    <label htmlFor="team-import-name" className="text-sm font-semibold text-text">
                      {t('teamImport.teamName')}
                    </label>
                    <Input
                      id="team-import-name"
                      value={state.teamName}
                      onChange={(event) => state.setTeamName(event.target.value)}
                      disabled={state.importing}
                    />
                    {teamNameError ? (
                      <p className="text-xs text-red-400">{formatNameValidation(teamNameError)}</p>
                    ) : null}
                  </div>

                  {state.preview.projectPath ? (
                    <div>
                      <p className="text-sm font-semibold text-text">
                        {t('teamImport.projectPath')}
                      </p>
                      <p className="break-all text-sm text-text-muted">
                        {state.preview.projectPath}
                      </p>
                    </div>
                  ) : state.preview.sourceLabel ? (
                    <div>
                      <p className="text-sm font-semibold text-text">{t('teamImport.source')}</p>
                      <p className="break-all text-sm text-text-muted">
                        {state.preview.sourceLabel}
                      </p>
                    </div>
                  ) : null}

                  {state.preview.teamDescription ? (
                    <p className="text-sm text-text-muted">{state.preview.teamDescription}</p>
                  ) : null}

                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold text-text">
                      {t('teamImport.members', { count: state.preview.members.length })}
                    </h3>
                    {state.preview.members.map((member) => {
                      const detail = memberDetailByName.get(member.name);
                      return (
                        <article key={member.name} className="rounded border border-border p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-medium text-text">{member.name}</h4>
                            {detail?.role ? (
                              <span className="text-xs text-text-muted">{detail.role}</span>
                            ) : null}
                          </div>
                          {detail && detail.skills.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {detail.skills.map((skill) => (
                                <span
                                  key={skill}
                                  className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted"
                                >
                                  {skill}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {detail && detail.memoryFileCount > 0 ? (
                            <p className="mt-1 text-xs text-text-muted">
                              {t('teamImport.memoryFiles', { count: detail.memoryFileCount })}
                            </p>
                          ) : null}
                          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-text-muted">
                            {member.workflow}
                          </pre>
                        </article>
                      );
                    })}
                  </section>

                  {state.preview.prompt ? (
                    <section>
                      <h3 className="text-sm font-semibold text-text">
                        {t('teamImport.leadPrompt')}
                      </h3>
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-border p-3 text-xs text-text-muted">
                        {state.preview.prompt}
                      </pre>
                    </section>
                  ) : null}

                  {state.preview.skillPlans && state.preview.skillPlans.length > 0 ? (
                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold text-text">
                        {t('teamImport.skillsToInstall', {
                          count: state.preview.skillPlans.length,
                        })}
                      </h3>
                      <p className="text-xs text-text-muted">{t('teamImport.skillsInstallNote')}</p>
                      {state.preview.skillPlans.map((plan) => (
                        <div
                          key={plan.slug}
                          className="flex flex-wrap items-center gap-2 rounded border border-border p-2"
                        >
                          <span className="text-sm text-text">{plan.slug}</span>
                          {plan.alreadyExists ? (
                            <span className="rounded-full border border-yellow-500/40 px-2 py-0.5 text-xs text-yellow-400">
                              {t('teamImport.skillAlreadyExists')}
                            </span>
                          ) : null}
                          {plan.description ? (
                            <span className="w-full text-xs text-text-muted">
                              {plan.description}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </section>
                  ) : state.preview.skillsFound.length > 0 ? (
                    <div>
                      <p className="text-sm font-semibold text-text">
                        {t('teamImport.skills', { count: state.preview.skillsFound.length })}
                      </p>
                      <p className="text-sm text-text-muted">
                        {state.preview.skillsFound.join(', ')}
                      </p>
                    </div>
                  ) : null}

                  {state.preview.warnings.length > 0 ? (
                    <div
                      role="status"
                      className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm text-yellow-400"
                    >
                      {state.preview.warnings.map((warning, index) => (
                        <p key={`${warning.code}-${index}`}>{formatWarning(warning)}</p>
                      ))}
                    </div>
                  ) : null}

                  {state.preview.blockingErrors.length > 0 ? (
                    <div
                      role="alert"
                      className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400"
                    >
                      {state.preview.blockingErrors.map((blockingError) => (
                        <p key={blockingError}>{blockingError}</p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div aria-live="polite">
                {state.error ? (
                  <div
                    role="alert"
                    className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400"
                  >
                    {state.error}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-border bg-surface px-6 py-4">
            <Button variant="outline" onClick={onClose} disabled={state.importing}>
              <X className="mr-1.5 size-3.5" />
              {t('teamImport.cancel')}
            </Button>
            <p className="min-w-64 flex-1 text-sm text-text-muted" aria-live="polite">
              {state.preview
                ? t('teamImport.summary', {
                    teamName: state.teamName,
                    count: state.preview.members.length,
                  })
                : t('teamImport.selectPrompt')}
            </p>
            <Button onClick={() => void state.createDraft()} disabled={!canCreate || state.loading}>
              {state.importing
                ? t('teamImport.creating')
                : state.preview?.importKind === 'smart'
                  ? t('teamImport.createDraftSmart')
                  : t('teamImport.createDraft')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
