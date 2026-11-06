import { useState } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@renderer/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { Copy, Loader2, Mic, Square, X } from 'lucide-react';

import { useDictation } from '../hooks/useDictation';

export const DictationOverlay = (): React.JSX.Element | null => {
  const { enabled, target, phase, seconds, position, error, transcript, start, stop, cancel } =
    useDictation();
  const [copied, setCopied] = useState(false);
  if (!enabled || !target) return null;
  // Stay within a modal's focus scope and pointer-event boundary when dictating
  // into dialogs. No field wrappers or per-form layout changes are necessary.
  const container = target.closest('[role="dialog"], [role="alertdialog"]') ?? document.body;
  let containingBlock: Element | null = container;
  while (containingBlock && containingBlock !== document.body) {
    const style = getComputedStyle(containingBlock);
    if (
      style.transform !== 'none' ||
      style.filter !== 'none' ||
      style.perspective !== 'none' ||
      style.contain.includes('paint')
    )
      break;
    containingBlock = containingBlock.parentElement;
  }
  const containerRect =
    containingBlock && containingBlock !== document.body
      ? containingBlock.getBoundingClientRect()
      : null;
  const busy = phase !== 'idle';
  return createPortal(
    <div
      data-dictation-toolbar
      className="fixed z-[10000] max-w-[calc(100vw-24px)] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-2 text-xs shadow-lg"
      style={{
        left: position.left - (containerRect?.left ?? 0),
        top: position.top - (containerRect?.top ?? 0),
        width: error || busy || transcript ? 350 : undefined,
      }}
      onPointerDown={(event) => {
        if (!(event.target instanceof HTMLTextAreaElement)) event.preventDefault();
      }}
    >
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={phase === 'starting' || phase === 'transcribing'}
              aria-label={
                phase === 'recording' ? 'Stop dictation and insert text' : 'Dictate with OpenWhispr'
              }
              onClick={() => {
                if (phase === 'recording') void stop();
                else void start();
              }}
            >
              {phase === 'recording' ? (
                <Square className="mr-1.5 size-3 text-red-400" />
              ) : busy ? (
                <Loader2 className="mr-1.5 size-3 animate-spin" />
              ) : (
                <Mic className="mr-1.5 size-3" />
              )}
              {phase === 'recording'
                ? `Stop · ${seconds}s`
                : phase === 'transcribing'
                  ? 'Transcribing…'
                  : phase === 'starting'
                    ? 'Starting…'
                    : 'Dictate'}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Use OpenWhispr to insert speech at your cursor. Text is never sent automatically.
          </TooltipContent>
        </Tooltip>
        {busy && (
          <span className="flex-1 text-[var(--color-text-muted)]">
            {phase === 'recording' ? 'Listening · Esc to cancel' : 'OpenWhispr · on device'}
          </span>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="size-7 p-0"
          aria-label={busy ? 'Cancel dictation' : 'Dismiss dictation'}
          onClick={cancel}
        >
          <X className="size-3" />
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 px-1 text-[var(--color-text-secondary)]">
          {error}
        </p>
      )}
      {transcript && (
        <div className="mt-2 border-t border-[var(--color-border)] pt-2">
          <p className="max-h-28 select-text overflow-auto whitespace-pre-wrap p-1">{transcript}</p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard
                .writeText(transcript)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            <Copy className="mr-1 size-3" />
            {copied ? 'Copied' : 'Copy transcript'}
          </Button>
        </div>
      )}
    </div>,
    container
  );
};
