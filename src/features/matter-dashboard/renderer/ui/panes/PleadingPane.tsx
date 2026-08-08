import { memo } from 'react';

import { AddButton, DeleteButton, DirInput, InlineInput, ToneSelect } from '../fieldPrimitives';
import { BODY, BORDER, FAINT, HAIRLINE, MUTED, PLEADING_STATUSES, RED } from '../matterTheme';

import type { MatterPartyDto, MatterPleadingRecordDto } from '../../../contracts';
import type { MatterEditor } from '../../hooks/useMatterEditor';

export interface PaneProps {
  editor: MatterEditor;
}

const OPERATIVE_BORDER = 'oklch(0.88 0.05 262)';
const OPERATIVE_BG = 'oklch(0.985 0.008 262)';

/** Label → record key for the per-card date/reference rows. */
const FIELD_ROWS: readonly {
  label: string;
  key: 'filed' | 'served' | 'responseDue' | 'responseFiled' | 'related' | 'amendmentDue';
  danger?: boolean;
}[] = [
  { label: 'Filed', key: 'filed' },
  { label: 'Served', key: 'served' },
  { label: 'Response due', key: 'responseDue' },
  { label: 'Response filed', key: 'responseFiled' },
  { label: 'Related', key: 'related' },
  { label: 'Amendment due', key: 'amendmentDue', danger: true },
];

interface PleadingColumn {
  key: string;
  title: string;
  subtitle: string;
  partyId?: string;
  records: MatterPleadingRecordDto[];
}

const PleadingCard = ({
  record,
  parties,
  editor,
}: {
  record: MatterPleadingRecordDto;
  parties: MatterPartyDto[];
  editor: MatterEditor;
}): React.JSX.Element => {
  const operative = record.status === 'Operative';
  const patch = (fields: Record<string, unknown>): void => {
    editor.updateRecord('pleading', 'records', record.id, fields);
  };
  return (
    <div
      style={{
        border: `1px solid ${operative ? OPERATIVE_BORDER : BORDER}`,
        borderRadius: 10,
        padding: '12px 14px',
        background: operative ? OPERATIVE_BG : '#fff',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <InlineInput
          value={record.type}
          onChange={(value) => patch({ type: value })}
          placeholder="Pleading type"
          size={13.5}
          bold
          flex
          negativeMargin
        />
        <ToneSelect
          value={record.status ?? ''}
          onChange={(value) => patch({ status: value })}
          options={PLEADING_STATUSES}
          pill
          small
        />
        <DeleteButton
          title="Delete pleading"
          onClick={() => editor.removeRecord('pleading', 'records', record.id)}
        />
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '104px 1fr',
          gap: 8,
          alignItems: 'center',
          fontSize: 12,
          marginBottom: 5,
        }}
      >
        <span style={{ color: MUTED }}>Filing party</span>
        <select
          value={record.partyId ?? ''}
          onChange={(e) => patch({ partyId: e.target.value || undefined })}
          className="cursor-pointer focus:outline-[oklch(0.75_0.1_262)]"
          style={{
            font: 'inherit',
            fontSize: 11.5,
            fontWeight: 600,
            padding: '2px 5px',
            borderRadius: 7,
            border: '1px solid #d6dae2',
            background: '#fff',
            maxWidth: '100%',
          }}
        >
          <option value="">Unassigned</option>
          {parties.map((party) => (
            <option key={party.id} value={party.id}>
              {party.name}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {FIELD_ROWS.map((row) => {
          const value = record[row.key] ?? '';
          return (
            <div
              key={row.key}
              style={{
                display: 'grid',
                gridTemplateColumns: '104px 1fr',
                gap: 8,
                alignItems: 'center',
                fontSize: 12,
              }}
            >
              <span style={{ color: MUTED }}>{row.label}</span>
              <InlineInput
                value={value}
                onChange={(next) => patch({ [row.key]: next })}
                size={12}
                color={row.danger && value ? RED : undefined}
                negativeMargin
              />
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${HAIRLINE}` }}>
        <InlineInput
          value={record.claims ?? ''}
          onChange={(value) => patch({ claims: value })}
          placeholder="Causes of action / affirmative defenses"
          size={11.5}
          color={BODY}
          negativeMargin
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 5 }}>
          <DirInput value={record.dir ?? ''} onChange={(value) => patch({ dir: value })} />
        </div>
      </div>
    </div>
  );
};

/** Pleading stage: one column per party, plus Unassigned for orphan records. */
export const PleadingPane = memo(function PleadingPane({ editor }: PaneProps): React.JSX.Element {
  const parties = editor.matter.parties ?? [];
  const records = editor.matter.pleading?.records ?? [];
  const partyIds = new Set(parties.map((party) => party.id));
  const unassigned = records.filter((record) => !record.partyId || !partyIds.has(record.partyId));

  const columns: PleadingColumn[] = parties.map((party) => {
    const partyRecords = records.filter((record) => record.partyId === party.id);
    return {
      key: party.id,
      title: party.name,
      subtitle: `${party.role ?? '—'} · ${partyRecords.length}`,
      partyId: party.id,
      records: partyRecords,
    };
  });
  if (unassigned.length > 0) {
    columns.push({
      key: 'unassigned',
      title: 'Unassigned',
      subtitle: `No filing party · ${unassigned.length}`,
      records: unassigned,
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Pleading</div>
        <div style={{ fontSize: 12.5, color: MUTED }}>
          {records.length} records · grouped by filing party
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div style={{ fontSize: 12, color: BODY }}>
          One column per party on the matter. Reassign a pleading with its party selector; parties
          are managed in the Parties panel.
        </div>
        <AddButton
          label="+ Add unassigned pleading"
          onClick={() => editor.addRecord('pleading', 'records', { type: '', status: 'Draft' })}
        />
      </div>
      {columns.length === 0 ? (
        <div style={{ fontSize: 11.5, color: FAINT }}>No pleadings yet.</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(272px, 1fr))',
            gap: 14,
          }}
        >
          {columns.map((column) => (
            <div key={column.key}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: MUTED,
                    }}
                  >
                    {column.title}
                  </div>
                  <div style={{ fontSize: 11, color: FAINT, marginTop: 1 }}>{column.subtitle}</div>
                </div>
                <AddButton
                  label="+ Add"
                  onClick={() =>
                    editor.addRecord('pleading', 'records', {
                      type: '',
                      status: 'Draft',
                      ...(column.partyId ? { partyId: column.partyId } : {}),
                    })
                  }
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {column.records.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: FAINT }}>No pleadings yet.</div>
                ) : (
                  column.records.map((record) => (
                    <PleadingCard
                      key={record.id}
                      record={record}
                      parties={parties}
                      editor={editor}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
