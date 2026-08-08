import { useMemo, useState } from 'react';

import { ACCENT, ACCENT_DARK, BODY, BORDER, FAINT, HAIRLINE, MUTED, RED } from './matterTheme';

import type { MatterChanges, MatterDto, MatterProposalDto } from '../../contracts';

const SECTION_LABELS: Record<keyof MatterChanges, string> = {
  caption: 'Caption',
  status: 'Status',
  matterNumber: 'Matter number',
  client: 'Client',
  caseNumber: 'Case number',
  department: 'Department',
  currentStage: 'Current stage',
  coreFields: 'Core fields',
  systemFields: 'System fields',
  stages: 'Stages',
  nextDeadline: 'Next deadline',
  parties: 'Parties',
  counsel: 'Counsel',
  pleading: 'Pleading',
  discovery: 'Discovery',
  trial: 'Trial',
  settlement: 'Settlement & Mediation',
  postJudgment: 'Post-judgment',
  events: 'Timeline events',
};

export interface ProposalReviewPanelProps {
  proposal: MatterProposalDto;
  /** The matter the proposal targets; null when it will create a new one. */
  matter: MatterDto | null;
  acting: boolean;
  onApprove: () => Promise<void>;
  onReject: (reason?: string) => Promise<void>;
}

function describeDiffValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => describeDiffValue(item)).join('; ');
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .join(' · ');
  }
  return String(value);
}

function buildSectionDiffRows(
  sectionKey: keyof MatterChanges,
  proposed: unknown,
  current: unknown
): { label: string; before: string; after: string }[] {
  const sectionLabel = SECTION_LABELS[sectionKey] ?? sectionKey;
  if (Array.isArray(proposed)) {
    return [
      {
        label: `${sectionLabel} (replaces list)`,
        before: describeDiffValue(current),
        after: describeDiffValue(proposed),
      },
    ];
  }
  if (proposed !== null && typeof proposed === 'object') {
    const currentRecord =
      current !== null && typeof current === 'object' ? (current as Record<string, unknown>) : {};
    return Object.entries(proposed as Record<string, unknown>).map(([key, value]) => ({
      label: `${sectionLabel} · ${key}`,
      before: describeDiffValue(currentRecord[key]),
      after: describeDiffValue(value),
    }));
  }
  return [
    {
      label: sectionLabel,
      before: describeDiffValue(current),
      after: describeDiffValue(proposed),
    },
  ];
}

/** True when the matter changed after the proposal was submitted. */
function isProposalStale(proposal: MatterProposalDto, matter: MatterDto | null): boolean {
  if (!matter?.updatedAt) return false;
  const proposedAt = Date.parse(proposal.proposedAt);
  const updatedAt = Date.parse(matter.updatedAt);
  return !Number.isNaN(proposedAt) && !Number.isNaN(updatedAt) && updatedAt > proposedAt;
}

export const ProposalReviewPanel = ({
  proposal,
  matter,
  acting,
  onApprove,
  onReject,
}: ProposalReviewPanelProps): React.JSX.Element => {
  const [reason, setReason] = useState('');

  const diffRows = useMemo(() => {
    const currentRecord = (matter ?? {}) as Record<string, unknown>;
    return (Object.keys(proposal.changes) as (keyof MatterChanges)[]).flatMap((sectionKey) =>
      buildSectionDiffRows(sectionKey, proposal.changes[sectionKey], currentRecord[sectionKey])
    );
  }, [proposal, matter]);

  const stale = isProposalStale(proposal, matter);

  return (
    <div
      style={{
        background: 'oklch(0.97 0.02 262)',
        border: '1px solid oklch(0.88 0.05 262)',
        borderRadius: 14,
        padding: '16px 20px',
        marginBottom: 20,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: ACCENT_DARK,
          }}
        >
          Proposed dashboard update — awaiting your review
        </span>
        <span style={{ fontSize: 12, color: MUTED }}>
          by @{proposal.proposedBy} · {proposal.proposedAt}
        </span>
      </div>
      <div style={{ fontSize: 12, color: BODY, marginBottom: 8 }}>
        {matter
          ? `Target matter: ${matter.caption ?? matter.id}`
          : 'Approving creates a new matter linked to this team.'}
      </div>
      {stale && (
        <div style={{ fontSize: 12, color: RED, marginBottom: 8 }}>
          The matter changed after this proposal was submitted — array sections it touches will
          replace your newer edits. Review the diff carefully.
        </div>
      )}
      <ul style={{ margin: '0 0 10px', paddingLeft: 18 }}>
        {proposal.summary.map((line, index) => (
          <li key={index} style={{ fontSize: 13, lineHeight: 1.5 }}>
            {line}
          </li>
        ))}
      </ul>
      {proposal.taskRefs && proposal.taskRefs.length > 0 && (
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 10 }}>
          From tasks: {proposal.taskRefs.map((taskId) => `#${taskId.slice(0, 8)}`).join(', ')}
        </div>
      )}
      {(proposal.sourceMode || proposal.sourceRevision) && (
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 10 }}>
          Evidence source: {proposal.sourceMode ?? 'unspecified'}
          {proposal.sourceRevision ? ` · revision ${proposal.sourceRevision}` : ''}
        </div>
      )}
      {proposal.evidence && proposal.evidence.length > 0 && (
        <div
          style={{
            background: '#fff',
            border: `1px solid ${BORDER}`,
            borderRadius: 10,
            padding: '8px 12px',
            marginBottom: 12,
            maxHeight: 150,
            overflowY: 'auto',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 750, color: MUTED, marginBottom: 5 }}>
            Supporting Link sources
          </div>
          {proposal.evidence.map((reference, index) => (
            <div
              key={`${reference.path}-${index}`}
              style={{ fontSize: 11.5, color: BODY, padding: '2px 0', overflowWrap: 'anywhere' }}
            >
              <span style={{ fontWeight: 650 }}>{reference.title ?? reference.path}</span>
              {reference.title ? ` · ${reference.path}` : ''}
              {reference.fieldPaths?.length ? ` · ${reference.fieldPaths.join(', ')}` : ''}
            </div>
          ))}
        </div>
      )}
      <div
        style={{
          background: '#fff',
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          padding: '10px 14px',
          marginBottom: 12,
          maxHeight: 260,
          overflowY: 'auto',
        }}
      >
        {diffRows.map((row, index) => (
          <div
            key={index}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(140px, 220px) 1fr',
              gap: 10,
              padding: '4px 0',
              borderBottom: index < diffRows.length - 1 ? `1px solid ${HAIRLINE}` : undefined,
              fontSize: 12.5,
            }}
          >
            <span style={{ color: MUTED }}>{row.label}</span>
            <span style={{ overflowWrap: 'anywhere' }}>
              {row.before !== row.after && (
                <span style={{ color: FAINT, textDecoration: 'line-through', marginRight: 8 }}>
                  {row.before}
                </span>
              )}
              <span style={{ fontWeight: 600 }}>{row.after}</span>
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={acting}
          onClick={() => void onApprove()}
          style={{
            font: 'inherit',
            fontSize: 12.5,
            fontWeight: 700,
            color: '#fff',
            background: acting ? '#a9b3c9' : ACCENT,
            border: 'none',
            borderRadius: 8,
            padding: '6px 14px',
            cursor: acting ? 'default' : 'pointer',
          }}
        >
          Approve &amp; update
        </button>
        <button
          type="button"
          disabled={acting}
          onClick={() => void onReject(reason.trim() || undefined)}
          style={{
            font: 'inherit',
            fontSize: 12.5,
            fontWeight: 700,
            color: RED,
            background: '#fff',
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            padding: '6px 14px',
            cursor: acting ? 'default' : 'pointer',
          }}
        >
          Reject
        </button>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Rejection reason (sent to the lead)"
          style={{
            font: 'inherit',
            fontSize: 12,
            padding: '5px 10px',
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            flex: 1,
            minWidth: 200,
          }}
        />
      </div>
    </div>
  );
};
