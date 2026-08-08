import { memo, useMemo, useState } from 'react';

import { Card } from './fieldPrimitives';
import {
  ACCENT,
  ACCENT_BG,
  ACCENT_DARK,
  BODY,
  DIM,
  GREEN,
  GREEN_BG,
  HAIRLINE,
  INK,
  MATTER_STATUSES,
  MUTED,
  PANEL_BG,
} from './matterTheme';

import type { MatterDto, MatterStageId } from '../../contracts/dto';

const STAGE_LABELS: Record<MatterStageId, string> = {
  pleading: 'Pleading',
  discovery: 'Discovery',
  trial: 'Trial',
  settlement: 'Settlement',
  post: 'Post-Judgment',
};

const GRID_COLUMNS = '2.4fr 1.1fr 1.1fr 1.5fr 0.9fr 0.7fr 14px';

type StatusFilter = 'All' | (typeof MATTER_STATUSES)[number];

export interface MattersListViewProps {
  matters: MatterDto[];
  linkedMatterIds: string[];
  /** False = demo mode; creating and (un)linking matters is disabled. */
  live: boolean;
  onOpen(matterId: string): void;
  onCreate(): void;
  onLink(matterId: string): void;
  onUnlink(matterId: string): void;
}

function shortDate(value: string | undefined): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleDateString();
}

function matchesQuery(matter: MatterDto, query: string): boolean {
  if (!query) return true;
  return [matter.caption, matter.client, matter.caseNumber, matter.matterNumber].some((field) =>
    field?.toLowerCase().includes(query)
  );
}

/** Firm-wide matter listing: search + status filter over every stored matter. */
export const MattersListView = memo(function MattersListView({
  matters,
  linkedMatterIds,
  live,
  onOpen,
  onCreate,
  onLink,
  onUnlink,
}: MattersListViewProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('All');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return matters.filter(
      (matter) => (status === 'All' || matter.status === status) && matchesQuery(matter, q)
    );
  }, [matters, query, status]);

  const activeCount = matters.filter((matter) => matter.status === 'Active').length;
  const linkedCount = matters.filter((matter) => linkedMatterIds.includes(matter.id)).length;
  const chips: StatusFilter[] = ['All', ...MATTER_STATUSES];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 24,
          flexWrap: 'wrap',
          marginBottom: 18,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: '-0.015em' }}>
            Matters
          </h1>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 9 }}>
            {matters.length} matters · {activeCount} active · {linkedCount} linked to this team
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search matter, client, case number"
            className="focus:border-[oklch(0.7_0.1_262)] focus:outline-none"
            style={{
              font: 'inherit',
              fontSize: 12.5,
              padding: '6px 12px',
              borderRadius: 9,
              border: '1px solid #d6dae2',
              background: '#fff',
              width: 238,
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {chips.map((chip) => {
              const on = status === chip;
              const count =
                chip === 'All'
                  ? matters.length
                  : matters.filter((matter) => matter.status === chip).length;
              return (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setStatus(chip)}
                  style={{
                    font: 'inherit',
                    fontSize: 11.5,
                    fontWeight: 600,
                    padding: '5px 11px',
                    borderRadius: 99,
                    cursor: 'pointer',
                    border: `1px solid ${on ? INK : '#d6dae2'}`,
                    background: on ? INK : '#fff',
                    color: on ? '#fff' : BODY,
                  }}
                >
                  {chip} · {count}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onCreate}
            disabled={!live}
            title={live ? undefined : 'Unavailable in demo mode'}
            style={{
              font: 'inherit',
              fontSize: 12,
              fontWeight: 600,
              padding: '5px 12px',
              borderRadius: 8,
              border: `1px solid ${INK}`,
              background: INK,
              color: '#fff',
              cursor: live ? 'pointer' : 'default',
              opacity: live ? 1 : 0.45,
            }}
          >
            + New matter
          </button>
        </div>
      </div>

      <Card padding="0" style={{ overflow: 'hidden' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: GRID_COLUMNS,
            gap: 16,
            padding: '11px 20px',
            background: PANEL_BG,
            borderBottom: '1px solid #e4e7ec',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: MUTED,
          }}
        >
          <span>Matter</span>
          <span>Client</span>
          <span>Stage</span>
          <span>Next deadline</span>
          <span>Updated</span>
          <span>Team</span>
          <span />
        </div>
        {visible.map((matter) => {
          const linked = linkedMatterIds.includes(matter.id);
          const closed = matter.status === 'Closed';
          const meta =
            [matter.matterNumber, matter.caseNumber, matter.department]
              .filter((part): part is string => Boolean(part))
              .join(' · ') || '—';
          const deadline = matter.nextDeadline;
          return (
            <div
              key={matter.id}
              onClick={() => onOpen(matter.id)}
              className="hover:bg-[#f7f8fa]"
              style={{
                display: 'grid',
                gridTemplateColumns: GRID_COLUMNS,
                gap: 16,
                alignItems: 'center',
                padding: '13px 20px',
                borderBottom: `1px solid ${HAIRLINE}`,
                cursor: 'pointer',
              }}
            >
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: '-0.005em' }}>
                  {matter.caption?.trim() || 'Untitled matter'}
                </div>
                <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>{meta}</div>
              </div>
              <div style={{ fontSize: 12.5, color: BODY }}>{matter.client || '—'}</div>
              <div>
                <span
                  style={{
                    display: 'inline-block',
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '2px 9px',
                    borderRadius: 99,
                    background: closed ? '#f4f5f8' : ACCENT_BG,
                    color: closed ? MUTED : ACCENT_DARK,
                  }}
                >
                  {STAGE_LABELS[matter.currentStage ?? 'discovery']}
                </span>
                <div style={{ fontSize: 11, color: DIM, marginTop: 3 }}>{matter.status || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: deadline?.date ? INK : DIM }}>
                  {deadline?.date || '—'}
                </div>
                <div style={{ fontSize: 11.5, color: MUTED }}>{deadline?.label ?? ''}</div>
              </div>
              <div style={{ fontSize: 12, color: MUTED }}>{shortDate(matter.updatedAt)}</div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 2,
                }}
              >
                {linked ? (
                  <>
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 600,
                        padding: '1px 8px',
                        borderRadius: 99,
                        background: GREEN_BG,
                        color: GREEN,
                      }}
                    >
                      Linked
                    </span>
                    <button
                      type="button"
                      disabled={!live}
                      onClick={(e) => {
                        e.stopPropagation();
                        onUnlink(matter.id);
                      }}
                      className="hover:text-[oklch(0.5_0.17_27)]"
                      style={{
                        font: 'inherit',
                        fontSize: 10.5,
                        border: 'none',
                        background: 'transparent',
                        padding: 0,
                        color: MUTED,
                        cursor: live ? 'pointer' : 'default',
                      }}
                    >
                      Unlink
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={!live}
                    onClick={(e) => {
                      e.stopPropagation();
                      onLink(matter.id);
                    }}
                    style={{
                      font: 'inherit',
                      fontSize: 10.5,
                      fontWeight: 600,
                      border: 'none',
                      background: 'transparent',
                      padding: 0,
                      color: live ? ACCENT : DIM,
                      cursor: live ? 'pointer' : 'default',
                    }}
                  >
                    Link
                  </button>
                )}
              </div>
              <div style={{ fontSize: 14, color: DIM }}>›</div>
            </div>
          );
        })}
        {visible.length === 0 && (
          <div style={{ padding: '26px 20px', fontSize: 12.5, color: '#b6bcc7' }}>
            {matters.length === 0
              ? 'No matters yet. Create one, or ask the team lead to scan the case folder.'
              : 'No matters match this filter.'}
          </div>
        )}
      </Card>
    </div>
  );
});
