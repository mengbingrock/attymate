import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@renderer/api';

import type {
  TeamImportJobProgress,
  TeamImportPreview,
  TeamImportSourceRequest,
} from '@features/team-import/contracts';

export type TeamImportSourceKind = 'folder' | 'url';

interface UseTeamImportDialogInput {
  open: boolean;
  onClose: () => void;
  onImported: (teamName: string, applyWarnings?: string[]) => void;
  inspectErrorFallback: string;
  createErrorFallback: string;
  resolveValidationError?: (code: string) => string | null;
}

function resolveRequestError(
  error: unknown,
  fallback: string,
  resolveValidationError?: (code: string) => string | null
): string {
  if (!(error instanceof Error)) return fallback;
  const validationPrefix = 'TEAM_IMPORT_VALIDATION:';
  const validationIndex = error.message.indexOf(validationPrefix);
  if (validationIndex === -1) return error.message;
  const code = error.message
    .slice(validationIndex + validationPrefix.length)
    .split(/[^A-Za-z0-9]/, 1)[0];
  return resolveValidationError?.(code) ?? fallback;
}

export function useTeamImportDialog(input: UseTeamImportDialogInput) {
  const [preview, setPreview] = useState<TeamImportPreview | null>(null);
  const [teamName, setTeamName] = useState('');
  const [leadName, setLeadName] = useState('');
  const [sourceKind, setSourceKind] = useState<TeamImportSourceKind>('folder');
  const [url, setUrl] = useState('');
  const [smart, setSmart] = useState(false);
  const [stage, setStage] = useState<TeamImportJobProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const importingRef = useRef(false);

  useEffect(() => {
    requestIdRef.current += 1;
    importingRef.current = false;
    setPreview(null);
    setTeamName('');
    setLeadName('');
    setSourceKind('folder');
    setUrl('');
    setSmart(false);
    setStage(null);
    setLoading(false);
    setImporting(false);
    setError(null);
  }, [input.open]);

  useEffect(() => {
    if (!input.open) return;
    return api.teamImport.onJobProgress((progress) => setStage(progress));
  }, [input.open]);

  const runPreview = useCallback(
    async (request: TeamImportSourceRequest) => {
      const requestId = ++requestIdRef.current;
      setPreview(null);
      setTeamName('');
      setLeadName('');
      setStage(null);
      setLoading(true);
      setError(null);
      try {
        const nextPreview = await api.teamImport.smartPreview(request);
        if (requestId !== requestIdRef.current) return;
        setPreview(nextPreview);
        setTeamName(nextPreview?.suggestedTeamName ?? '');
        const suggestedLeadName = nextPreview?.suggestedLeadName;
        setLeadName(
          suggestedLeadName &&
            nextPreview?.members.some((member) => member.name === suggestedLeadName)
            ? suggestedLeadName
            : ''
        );
      } catch (nextError) {
        if (requestId !== requestIdRef.current) return;
        setError(
          resolveRequestError(nextError, input.inspectErrorFallback, input.resolveValidationError)
        );
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setStage(null);
        }
      }
    },
    [input.inspectErrorFallback, input.resolveValidationError]
  );

  const chooseFolder = useCallback(
    () => runPreview({ kind: 'folder', smart }),
    [runPreview, smart]
  );

  const previewUrl = useCallback(() => {
    if (!url.trim()) return Promise.resolve();
    return runPreview({ kind: 'url', url: url.trim() });
  }, [runPreview, url]);

  const retrySmart = useCallback(() => {
    setSmart(true);
    return runPreview({
      kind: 'folder',
      smart: true,
      ...(preview?.projectPath ? { folderPath: preview.projectPath } : {}),
    });
  }, [preview?.projectPath, runPreview]);

  const createDraft = useCallback(async () => {
    if (
      !preview ||
      preview.blockingErrors.length > 0 ||
      !preview.members.some((member) => member.name === leadName) ||
      importingRef.current
    )
      return;
    importingRef.current = true;
    setImporting(true);
    setError(null);
    try {
      const result = await api.teamImport.createDraft({
        reviewId: preview.reviewId,
        teamName,
        leadName,
      });
      input.onImported(result.teamName, result.applyWarnings);
      input.onClose();
    } catch (nextError) {
      setError(
        resolveRequestError(nextError, input.createErrorFallback, input.resolveValidationError)
      );
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  }, [input, leadName, preview, teamName]);

  return {
    preview,
    teamName,
    setTeamName,
    leadName,
    setLeadName,
    sourceKind,
    setSourceKind,
    url,
    setUrl,
    smart,
    setSmart,
    stage,
    loading,
    importing,
    error,
    chooseFolder,
    previewUrl,
    retrySmart,
    createDraft,
  };
}
