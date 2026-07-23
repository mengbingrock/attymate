import { useCallback, useEffect, useState } from 'react';

import { EmbeddedTerminal } from '@renderer/components/terminal/EmbeddedTerminal';
import { X } from 'lucide-react';

import type { OpenConsoleResultDto } from '../../contracts';

interface MemberConsoleSheetProps {
  teamName: string;
  memberName: string;
  onClose: () => void;
}

/**
 * In-app interactive console attached to a team member's tmux pane. Closing
 * the sheet kills the PTY (tmux client detach) and asks main to remove the
 * backing viewer session; the agent keeps running.
 */
export function MemberConsoleSheet({
  teamName,
  memberName,
  onClose,
}: Readonly<MemberConsoleSheetProps>) {
  const [target, setTarget] = useState<OpenConsoleResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let opened: OpenConsoleResultDto | null = null;
    window.electronAPI.interactiveTeamRuntime
      .openConsole(teamName, memberName)
      .then((result) => {
        opened = result;
        if (!cancelled) {
          setTarget(result);
        }
      })
      .catch((openError: unknown) => {
        if (!cancelled) {
          setError(openError instanceof Error ? openError.message : String(openError));
        }
      });
    return () => {
      cancelled = true;
      if (opened) {
        void window.electronAPI.interactiveTeamRuntime.closeConsole(
          teamName,
          opened.viewerSessionName
        );
      }
    };
  }, [teamName, memberName]);

  const handleExit = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-[70%] min-w-[480px] flex-col border-l border-[var(--color-border)] bg-[#1a1a1a] shadow-2xl">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-white">{memberName}</span>
          <span className="ml-2 text-xs text-neutral-400">
            live console — typing goes directly to this agent
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close console"
          className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {error ? (
          <div className="p-4 text-sm text-red-400">{error}</div>
        ) : target ? (
          <EmbeddedTerminal
            command={target.command}
            args={target.args}
            onExit={handleExit}
            className="h-full"
          />
        ) : (
          <div className="p-4 text-sm text-neutral-400">Attaching to agent session…</div>
        )}
      </div>
    </div>
  );
}
