import { memo, useState } from 'react';

import {
  AddButton,
  Card,
  DeleteButton,
  InlineInput,
  PanelTitle,
  ToneSelect,
} from './fieldPrimitives';
import {
  BODY,
  BORDER,
  COUNSEL_ROLES,
  FAINT,
  HAIRLINE,
  MUTED,
  PARTY_KINDS,
  PARTY_SIDES,
} from './matterTheme';

import type { MatterCounselDto, MatterPartyDto } from '../../contracts/dto';
import type { MatterEditor } from '../hooks/useMatterEditor';

type FieldKey<T> = Extract<keyof T, string>;

const PARTY_ROWS: readonly [FieldKey<MatterPartyDto>, string, string?][] = [
  ['contact', 'Contact person'],
  ['phone', 'Phone'],
  ['email', 'Email'],
  ['address', 'Address'],
  ['notes', 'Notes', BODY],
];

const COUNSEL_ROWS: readonly [FieldKey<MatterCounselDto>, string, string?][] = [
  ['firm', 'Firm / business'],
  ['bar', 'Bar number'],
  ['phone', 'Phone'],
  ['email', 'Email'],
  ['address', 'Address'],
  ['notes', 'Notes', BODY],
];

const detailLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: FAINT,
};

function partyAccent(side: string | undefined): string {
  if (side === 'Opposing') return 'oklch(0.9 0.04 27)';
  if (side === 'Our client') return 'oklch(0.88 0.05 262)';
  return BORDER;
}

const CounselCard = ({
  counsel,
  parties,
  editor,
}: {
  counsel: MatterCounselDto;
  parties: MatterPartyDto[];
  editor: MatterEditor;
}): React.JSX.Element => (
  <div
    style={{
      background: '#fbfbfc',
      border: '1px solid #eceef2',
      borderRadius: 9,
      padding: '9px 11px',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
      <InlineInput
        value={counsel.name}
        onChange={(name) => editor.updateRecord('counsel', null, counsel.id, { name })}
        placeholder="Attorney name"
        size={12}
        bold
        flex
      />
      <DeleteButton
        title="Delete counsel"
        onClick={() => editor.removeRecord('counsel', null, counsel.id)}
      />
    </div>
    <div style={{ marginBottom: 6 }}>
      <ToneSelect
        value={counsel.role ?? 'Lead counsel'}
        onChange={(role) => editor.updateRecord('counsel', null, counsel.id, { role })}
        options={COUNSEL_ROLES}
        pill
        small
      />
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {COUNSEL_ROWS.map(([key, label, color]) => (
        <div key={key}>
          <div style={detailLabelStyle}>{label}</div>
          <InlineInput
            value={counsel[key] ?? ''}
            onChange={(value) => editor.updateRecord('counsel', null, counsel.id, { [key]: value })}
            placeholder={label}
            size={11.5}
            color={color}
            negativeMargin
          />
        </div>
      ))}
      <div>
        <div style={detailLabelStyle}>Represents</div>
        <select
          value={counsel.partyId ?? ''}
          onChange={(e) =>
            editor.updateRecord('counsel', null, counsel.id, {
              partyId: e.target.value || undefined,
            })
          }
          className="cursor-pointer focus:outline-[oklch(0.75_0.1_262)]"
          style={{
            font: 'inherit',
            fontSize: 10.5,
            fontWeight: 600,
            padding: '2px 5px',
            borderRadius: 6,
            border: '1px solid #d6dae2',
            background: '#fff',
            maxWidth: '100%',
          }}
        >
          <option value="">Unassigned</option>
          {parties.map((party) => (
            <option key={party.id} value={party.id}>
              {party.name || 'Unnamed party'}
            </option>
          ))}
        </select>
      </div>
    </div>
  </div>
);

/** Parties with their counsel of record; orphan counsel list at the bottom. */
export const PartiesPanel = memo(function PartiesPanel({
  editor,
}: {
  editor: MatterEditor;
}): React.JSX.Element {
  const [openParties, setOpenParties] = useState<Set<string>>(() => new Set());
  const parties = editor.matter.parties ?? [];
  const counsel = editor.matter.counsel ?? [];
  const orphanCounsel = counsel.filter(
    (entry) => !parties.some((party) => party.id === entry.partyId)
  );

  const toggleParty = (id: string): void => {
    setOpenParties((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Card padding="14px 18px">
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 4,
        }}
      >
        <PanelTitle>Parties &amp; Counsel</PanelTitle>
        <AddButton
          label="+ Add"
          onClick={() =>
            editor.addRecord('parties', null, { name: '', side: 'Other', kind: 'Individual' })
          }
        />
      </div>
      <div style={{ fontSize: 11, color: FAINT, marginBottom: 10 }}>
        {parties.length} parties · {counsel.length} counsel of record
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {parties.map((party) => {
          const open = openParties.has(party.id);
          const partyCounsel = counsel.filter((entry) => entry.partyId === party.id);
          return (
            <div
              key={party.id}
              style={{
                border: `1px solid ${partyAccent(party.side)}`,
                borderRadius: 10,
                padding: '10px 12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  title="Show contact and counsel"
                  onClick={() => toggleParty(party.id)}
                  className="hover:border-[#c6ccd6]"
                  style={{
                    font: 'inherit',
                    width: 18,
                    height: 18,
                    borderRadius: 5,
                    border: `1px solid ${BORDER}`,
                    background: '#fff',
                    color: BODY,
                    cursor: 'pointer',
                    fontSize: 11,
                    lineHeight: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {open ? '−' : '+'}
                </button>
                <InlineInput
                  value={party.name}
                  onChange={(name) => editor.updateRecord('parties', null, party.id, { name })}
                  placeholder="Party name"
                  bold
                  flex
                />
                <DeleteButton
                  title="Delete party"
                  onClick={() => editor.removeRecord('parties', null, party.id)}
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  flexWrap: 'wrap',
                  margin: '6px 0 0 24px',
                }}
              >
                <ToneSelect
                  value={party.side ?? 'Other'}
                  onChange={(side) => editor.updateRecord('parties', null, party.id, { side })}
                  options={PARTY_SIDES}
                  pill
                  small
                />
                <ToneSelect
                  value={party.kind ?? 'Individual'}
                  onChange={(kind) => editor.updateRecord('parties', null, party.id, { kind })}
                  options={PARTY_KINDS}
                  plain
                  small
                />
              </div>
              <div style={{ margin: '3px 0 0 24px' }}>
                <InlineInput
                  value={party.role ?? ''}
                  onChange={(role) => editor.updateRecord('parties', null, party.id, { role })}
                  placeholder="Designation in this matter"
                  size={11.5}
                  color={MUTED}
                  negativeMargin
                />
              </div>
              {!open && (
                <div
                  style={{ fontSize: 11, color: FAINT, margin: '4px 0 0 24px', lineHeight: 1.4 }}
                >
                  {partyCounsel.map((entry) => entry.name || 'Unnamed').join(' · ') ||
                    'No counsel of record'}
                </div>
              )}
              {open && (
                <>
                  <div
                    style={{
                      margin: '9px 0 0 24px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    {PARTY_ROWS.map(([key, label, color]) => (
                      <div key={key}>
                        <div style={detailLabelStyle}>{label}</div>
                        <InlineInput
                          value={party[key] ?? ''}
                          onChange={(value) =>
                            editor.updateRecord('parties', null, party.id, { [key]: value })
                          }
                          placeholder={label}
                          size={11.5}
                          color={color}
                          negativeMargin
                        />
                      </div>
                    ))}
                  </div>
                  <div
                    style={{
                      margin: '11px 0 0 24px',
                      paddingTop: 9,
                      borderTop: `1px solid ${HAIRLINE}`,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        marginBottom: 8,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          color: FAINT,
                        }}
                      >
                        {partyCounsel.length} counsel of record
                      </div>
                      <AddButton
                        label="+ Counsel"
                        onClick={() =>
                          editor.addRecord('counsel', null, {
                            partyId: party.id,
                            name: '',
                            role: 'Lead counsel',
                          })
                        }
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                      {partyCounsel.map((entry) => (
                        <CounselCard
                          key={entry.id}
                          counsel={entry}
                          parties={parties}
                          editor={editor}
                        />
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      {orphanCounsel.length > 0 && (
        <div style={{ marginTop: 11, paddingTop: 10, borderTop: `1px solid ${HAIRLINE}` }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: FAINT,
              marginBottom: 8,
            }}
          >
            Counsel not linked to a party
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {orphanCounsel.map((entry) => (
              <CounselCard key={entry.id} counsel={entry} parties={parties} editor={editor} />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
});
