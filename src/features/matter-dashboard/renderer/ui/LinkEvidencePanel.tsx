import { ACCENT, ACCENT_DARK, BODY, BORDER, INK, MUTED, RED } from './matterTheme';

import type { MatterEvidenceStatusDto } from '../../contracts';

export interface LinkEvidencePanelProps {
  readonly status: MatterEvidenceStatusDto | null;
  readonly acting: boolean;
  readonly message: string | null;
  readonly error: string | null;
  readonly onCheck: () => Promise<void>;
  readonly onInitialize: () => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly onProposal: () => Promise<void>;
}

/**
 * State-gated Link evidence controls for the active matter: check status,
 * initialize the wiki, ask the lead to ingest, or build a bounded
 * Link-backed proposal.
 */
export function LinkEvidencePanel({
  status,
  acting,
  message,
  error,
  onCheck,
  onInitialize,
  onRefresh,
  onProposal,
}: LinkEvidencePanelProps): React.JSX.Element {
  const state = status?.state ?? 'not checked';
  const stateColor =
    status?.state === 'ready'
      ? ACCENT_DARK
      : status?.state === 'blocked' || status?.state === 'error'
        ? RED
        : BODY;
  const buttonStyle: React.CSSProperties = {
    border: `1px solid ${BORDER}`,
    borderRadius: 8,
    background: '#fff',
    color: INK,
    cursor: acting ? 'default' : 'pointer',
    font: 'inherit',
    fontSize: 12,
    fontWeight: 650,
    padding: '5px 10px',
  };

  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: '12px 16px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 240, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 750 }}>Link evidence</span>
          <span
            style={{
              border: `1px solid ${BORDER}`,
              borderRadius: 99,
              color: stateColor,
              fontSize: 11,
              fontWeight: 700,
              padding: '1px 8px',
            }}
          >
            {state}
          </span>
          {status && (
            <span style={{ color: MUTED, fontSize: 11.5 }}>
              {status.counts.representedFiles}/{status.counts.sourceFiles} represented
              {status.counts.pendingFiles ? ` · ${status.counts.pendingFiles} pending` : ''}
              {status.counts.staleFiles ? ` · ${status.counts.staleFiles} stale` : ''}
            </span>
          )}
        </div>
        <div style={{ color: error ? RED : MUTED, fontSize: 11.5, marginTop: 4 }}>
          {error ?? message ?? 'Check whether this matter has current, queryable Link evidence.'}
        </div>
        {status?.state === 'not-initialized' && (
          <div style={{ color: MUTED, fontSize: 10.5, marginTop: 3 }}>
            Initialize creates Link-generated wiki files inside the configured project folder.
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        <button type="button" disabled={acting} onClick={() => void onCheck()} style={buttonStyle}>
          {acting ? 'Working…' : 'Check status'}
        </button>
        {status?.state === 'not-initialized' && (
          <button
            type="button"
            disabled={acting}
            onClick={() => void onInitialize()}
            style={{ ...buttonStyle, color: ACCENT_DARK }}
          >
            Initialize Link
          </button>
        )}
        {(status?.state === 'pending' || status?.state === 'stale') && (
          <button
            type="button"
            disabled={acting}
            onClick={() => void onRefresh()}
            style={{ ...buttonStyle, color: ACCENT_DARK }}
          >
            Ask lead to ingest
          </button>
        )}
        {status?.state === 'ready' && (
          <button
            type="button"
            disabled={acting}
            onClick={() => void onProposal()}
            style={{ ...buttonStyle, background: ACCENT, borderColor: ACCENT, color: '#fff' }}
          >
            Build proposal from Link
          </button>
        )}
      </div>
    </div>
  );
}
