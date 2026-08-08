import { memo } from 'react';

import {
  AddButton,
  DeleteButton,
  DirInput,
  InlineInput,
  SectionHeader,
  ToneSelect,
} from '../fieldPrimitives';
import {
  ACCENT,
  BODY,
  BORDER,
  HAIRLINE,
  MEDIATION_RESULTS,
  MEDIATION_STATUSES,
  MUTED,
  PANEL_BG,
  SETTLEMENT_OUTCOMES,
  SETTLEMENT_TYPES,
} from '../matterTheme';

import type { MatterEditor } from '../../hooks/useMatterEditor';

export interface PaneProps {
  editor: MatterEditor;
}

const RECORD_GRID = '0.8fr 1.1fr 1.4fr 0.9fr 1.1fr 1.6fr 26px';

/** Accent-tinted card chrome for mediations that are still scheduled. */
const SCHEDULED_BORDER = 'oklch(0.88 0.05 262)';
const SCHEDULED_BG = 'oklch(0.985 0.008 262)';

const MEDIATION_DETAILS = [
  ['Mediator', 'mediator'],
  ['Organization', 'org'],
  ['Contact', 'contact'],
  ['Method', 'method'],
  ['Location', 'location'],
  ['Participants', 'participants'],
  ['Amount discussed', 'amount'],
  ['Brief deadline', 'deadline'],
] as const;

const MEDIATION_NOTES = [
  ['Discussion', 'discussion'],
  ['Unresolved', 'unresolved'],
  ['Next step', 'next'],
] as const;

export const SettlementPane = memo(function SettlementPane({
  editor,
}: PaneProps): React.JSX.Element {
  const settlement = editor.matter.settlement;
  const records = settlement?.records ?? [];
  const mediations = settlement?.mediations ?? [];

  const patch = (key: string, id: string, changes: Record<string, unknown>): void => {
    editor.updateRecord('settlement', key, id, changes);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700, flexShrink: 0 }}>
          Settlement &amp; Mediation
        </div>
        <InlineInput
          flex
          bold
          size={12.5}
          color={ACCENT}
          value={settlement?.statusNote ?? ''}
          placeholder="Status note"
          onChange={(v) => editor.patchSection('settlement', { statusNote: v })}
        />
      </div>

      <SectionHeader
        title="Settlement records"
        action={
          <AddButton
            label="+ Add record"
            onClick={() =>
              editor.addRecord('settlement', 'records', { type: 'Demand', outcome: 'Proposed' })
            }
          />
        }
      />
      <div
        style={{
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          overflow: 'hidden',
          marginBottom: 18,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: RECORD_GRID,
            gap: 8,
            padding: '8px 12px',
            background: PANEL_BG,
            borderBottom: `1px solid ${BORDER}`,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: MUTED,
          }}
        >
          <span>Date</span>
          <span>Type</span>
          <span>Parties</span>
          <span>Amount</span>
          <span>Outcome</span>
          <span>Conditions · terms</span>
          <span />
        </div>
        {records.map((r) => (
          <div key={r.id} style={{ padding: '6px 12px', borderBottom: `1px solid ${HAIRLINE}` }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: RECORD_GRID,
                gap: 8,
                alignItems: 'center',
                fontSize: 12,
              }}
            >
              <InlineInput
                negativeMargin
                size={12}
                color={BODY}
                value={r.date ?? ''}
                placeholder="Date"
                onChange={(v) => patch('records', r.id, { date: v })}
              />
              <span>
                <ToneSelect
                  plain
                  small
                  options={SETTLEMENT_TYPES}
                  value={r.type ?? 'Demand'}
                  onChange={(v) => patch('records', r.id, { type: v })}
                />
              </span>
              <InlineInput
                negativeMargin
                size={12}
                color={BODY}
                value={r.parties ?? ''}
                placeholder="Proposing → recipient"
                onChange={(v) => patch('records', r.id, { parties: v })}
              />
              <InlineInput
                negativeMargin
                mono
                bold
                size={11.5}
                value={r.amount ?? ''}
                placeholder="USD"
                onChange={(v) => patch('records', r.id, { amount: v })}
              />
              <span>
                <ToneSelect
                  pill
                  small
                  options={SETTLEMENT_OUTCOMES}
                  value={r.outcome ?? 'Proposed'}
                  onChange={(v) => patch('records', r.id, { outcome: v })}
                />
              </span>
              <InlineInput
                negativeMargin
                size={12}
                color={BODY}
                value={r.terms ?? ''}
                placeholder="Conditions, non-monetary terms"
                onChange={(v) => patch('records', r.id, { terms: v })}
              />
              <DeleteButton
                title="Delete record"
                onClick={() => editor.removeRecord('settlement', 'records', r.id)}
              />
            </div>
            <DirInput value={r.dir ?? ''} onChange={(v) => patch('records', r.id, { dir: v })} />
          </div>
        ))}
      </div>

      <SectionHeader
        title="Mediation"
        action={
          <AddButton
            label="+ Add mediation"
            onClick={() =>
              editor.addRecord('settlement', 'mediations', {
                status: 'Scheduled',
                result: 'Pending',
              })
            }
          />
        }
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {mediations.map((m) => {
          const scheduled = m.status === 'Scheduled';
          return (
            <div
              key={m.id}
              style={{
                border: `1px solid ${scheduled ? SCHEDULED_BORDER : BORDER}`,
                background: scheduled ? SCHEDULED_BG : '#fff',
                borderRadius: 10,
                padding: '13px 15px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 9,
                  flexWrap: 'wrap',
                }}
              >
                <InlineInput
                  flex
                  bold
                  negativeMargin
                  size={13.5}
                  value={m.when ?? ''}
                  placeholder="Date and time"
                  onChange={(v) => patch('mediations', m.id, { when: v })}
                />
                <ToneSelect
                  pill
                  small
                  options={MEDIATION_STATUSES}
                  value={m.status ?? 'Scheduled'}
                  onChange={(v) => patch('mediations', m.id, { status: v })}
                />
                <ToneSelect
                  pill
                  small
                  options={MEDIATION_RESULTS}
                  value={m.result ?? 'Pending'}
                  onChange={(v) => patch('mediations', m.id, { result: v })}
                />
                <DeleteButton
                  title="Delete mediation"
                  onClick={() => editor.removeRecord('settlement', 'mediations', m.id)}
                />
              </div>
              <div
                style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '5px 18px' }}
              >
                {MEDIATION_DETAILS.map(([label, key]) => (
                  <div
                    key={key}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '112px 1fr',
                      gap: 8,
                      alignItems: 'center',
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: MUTED }}>{label}</span>
                    <InlineInput
                      negativeMargin
                      size={12}
                      value={m[key] ?? ''}
                      onChange={(v) => patch('mediations', m.id, { [key]: v })}
                    />
                  </div>
                ))}
              </div>
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 9,
                  borderTop: `1px solid ${HAIRLINE}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                }}
              >
                {MEDIATION_NOTES.map(([label, key]) => (
                  <div
                    key={key}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '118px 1fr',
                      gap: 8,
                      alignItems: 'center',
                      fontSize: 11.5,
                    }}
                  >
                    <span style={{ color: MUTED }}>{label}</span>
                    <InlineInput
                      negativeMargin
                      size={11.5}
                      value={m[key] ?? ''}
                      onChange={(v) => patch('mediations', m.id, { [key]: v })}
                    />
                  </div>
                ))}
                <DirInput
                  value={m.dir ?? ''}
                  onChange={(v) => patch('mediations', m.id, { dir: v })}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
