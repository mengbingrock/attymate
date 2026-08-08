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
  DEPOSITION_REVIEWS,
  FAINT,
  HAIRLINE,
  INK,
  MEET_CONFER_METHODS,
  MEET_CONFER_OUTCOMES,
  MOTION_OUTCOMES,
  MUTED,
  PANEL_BG,
  PRODUCTION_TYPES,
  RED,
  REQUEST_STATUSES,
  REQUEST_TYPES,
} from '../matterTheme';

import type {
  MatterDepositionDto,
  MatterMeetConferDto,
  MatterMotionDto,
  MatterProductionDto,
} from '../../../contracts';
import type { MatterEditor } from '../../hooks/useMatterEditor';

export interface PaneProps {
  editor: MatterEditor;
}

const PENDING_BORDER = 'oklch(0.9 0.04 27)';
const PENDING_BG = 'oklch(0.985 0.008 27)';

const REQUEST_GRID = '1.4fr 1.5fr 1.3fr 0.8fr 0.8fr 0.8fr 0.9fr 1.1fr 26px';
const REQUEST_HEADERS = [
  'Type',
  'Set / Scope',
  'Parties',
  'Issued',
  'Served',
  'Resp. due',
  'Prod. due',
  'Status',
  '',
] as const;
const REQUEST_CELLS = ['set', 'parties', 'issued', 'served', 'due', 'prodDue'] as const;

type MotionFieldKey =
  | 'movingParty'
  | 'request'
  | 'reservation'
  | 'filed'
  | 'oppositionDue'
  | 'replyDue'
  | 'hearing'
  | 'ruled';

const MOTION_ROWS: readonly { label: string; key: MotionFieldKey; danger?: boolean }[] = [
  { label: 'Moving party', key: 'movingParty' },
  { label: 'Related request', key: 'request' },
  { label: 'Reservation', key: 'reservation' },
  { label: 'Filed', key: 'filed' },
  { label: 'Opposition due', key: 'oppositionDue', danger: true },
  { label: 'Reply due', key: 'replyDue' },
  { label: 'Hearing', key: 'hearing' },
  { label: 'Ruled', key: 'ruled' },
];

type Patch = (patch: Record<string, unknown>) => void;

const EmptyLine = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div style={{ fontSize: 11.5, color: FAINT }}>{children}</div>
);

const boxStyle: React.CSSProperties = {
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  padding: '13px 15px',
};

const rowGrid = (columns: string): React.CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: columns,
  gap: 7,
  alignItems: 'center',
  fontSize: 12,
});

const MotionCard = ({
  motion,
  patch,
  onDelete,
}: {
  motion: MatterMotionDto;
  patch: Patch;
  onDelete: () => void;
}): React.JSX.Element => {
  const pending = motion.outcome === 'Pending';
  return (
    <div
      style={{
        border: `1px solid ${pending ? PENDING_BORDER : BORDER}`,
        background: pending ? PENDING_BG : '#fff',
        borderRadius: 10,
        padding: '12px 14px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        <InlineInput
          value={motion.type}
          onChange={(value) => patch({ type: value })}
          placeholder="Motion type"
          size={13.5}
          bold
          flex
          negativeMargin
        />
        <ToneSelect
          value={motion.outcome ?? ''}
          onChange={(value) => patch({ outcome: value })}
          options={MOTION_OUTCOMES}
          pill
          small
        />
        <DeleteButton title="Delete motion" onClick={onDelete} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px 16px' }}>
        {MOTION_ROWS.map((row) => {
          const value = motion[row.key] ?? '';
          return (
            <div
              key={row.key}
              style={{
                display: 'grid',
                gridTemplateColumns: '96px 1fr',
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
      <div style={{ marginTop: 9, paddingTop: 8, borderTop: `1px solid ${HAIRLINE}` }}>
        <InlineInput
          value={motion.issues ?? ''}
          onChange={(value) => patch({ issues: value })}
          placeholder="Issues, relief sought, sanctions"
          size={11.5}
          color={BODY}
          negativeMargin
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 4 }}>
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: FAINT,
              flexShrink: 0,
            }}
          >
            Linked files
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <DirInput value={motion.dir ?? ''} onChange={(value) => patch({ dir: value })} />
          </span>
        </div>
      </div>
    </div>
  );
};

const MeetConferEntry = ({
  mc,
  patch,
  onDelete,
}: {
  mc: MatterMeetConferDto;
  patch: Patch;
  onDelete: () => void;
}): React.JSX.Element => (
  <div>
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 5 }}
    >
      <InlineInput
        value={mc.date ?? ''}
        onChange={(value) => patch({ date: value })}
        placeholder="Date / time"
        size={12.5}
        bold
        width={120}
        negativeMargin
      />
      <ToneSelect
        value={mc.method ?? ''}
        onChange={(value) => patch({ method: value })}
        options={MEET_CONFER_METHODS}
        plain
        small
      />
      <ToneSelect
        value={mc.outcome ?? ''}
        onChange={(value) => patch({ outcome: value })}
        options={MEET_CONFER_OUTCOMES}
        pill
        small
      />
      <span style={{ marginLeft: 'auto' }}>
        <DeleteButton title="Delete record" onClick={onDelete} />
      </span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <InlineInput
        value={mc.participants ?? ''}
        onChange={(value) => patch({ participants: value })}
        placeholder="Participants"
        size={11.5}
        color={MUTED}
        negativeMargin
      />
      <InlineInput
        value={mc.dispute ?? ''}
        onChange={(value) => patch({ dispute: value })}
        placeholder="Disputed issues"
        size={11.5}
        color={BODY}
        negativeMargin
      />
      <InlineInput
        value={mc.next ?? ''}
        onChange={(value) => patch({ next: value })}
        placeholder="Next step"
        size={11.5}
        color={INK}
        negativeMargin
      />
      <DirInput value={mc.dir ?? ''} onChange={(value) => patch({ dir: value })} />
    </div>
  </div>
);

const ProductionRow = ({
  production,
  patch,
  onDelete,
}: {
  production: MatterProductionDto;
  patch: Patch;
  onDelete: () => void;
}): React.JSX.Element => (
  <div>
    <div style={rowGrid('auto 1.3fr 0.9fr 0.8fr 20px')}>
      <ToneSelect
        value={production.type}
        onChange={(value) => patch({ type: value })}
        options={PRODUCTION_TYPES}
        plain
        small
      />
      <InlineInput
        value={production.bates ?? ''}
        onChange={(value) => patch({ bates: value })}
        placeholder="Bates range / count"
        size={11.5}
      />
      <InlineInput
        value={production.date ?? ''}
        onChange={(value) => patch({ date: value })}
        placeholder="Date"
        size={11.5}
      />
      <InlineInput
        value={production.party ?? ''}
        onChange={(value) => patch({ party: value })}
        placeholder="Party"
        size={11.5}
      />
      <DeleteButton title="Delete production" onClick={onDelete} />
    </div>
    <DirInput value={production.dir ?? ''} onChange={(value) => patch({ dir: value })} />
  </div>
);

const DepositionRow = ({
  deposition,
  patch,
  onDelete,
}: {
  deposition: MatterDepositionDto;
  patch: Patch;
  onDelete: () => void;
}): React.JSX.Element => {
  const note = deposition.note ?? '';
  return (
    <div>
      <div style={rowGrid('1.1fr 1fr auto 1.1fr 20px')}>
        <InlineInput
          value={deposition.name}
          onChange={(value) => patch({ name: value })}
          placeholder="Deponent"
          size={12}
          bold
        />
        <InlineInput
          value={deposition.taken ?? ''}
          onChange={(value) => patch({ taken: value })}
          placeholder="Dates"
          size={11.5}
          color={MUTED}
        />
        <ToneSelect
          value={deposition.review ?? ''}
          onChange={(value) => patch({ review: value })}
          options={DEPOSITION_REVIEWS}
          plain
          small
        />
        <InlineInput
          value={note}
          onChange={(value) => patch({ note: value })}
          placeholder="Transcript / errata"
          size={11.5}
          color={/errata|follow/i.test(note) ? RED : MUTED}
        />
        <DeleteButton title="Delete deposition" onClick={onDelete} />
      </div>
      <DirInput value={deposition.dir ?? ''} onChange={(value) => patch({ dir: value })} />
    </div>
  );
};

/** Discovery stage: requests table, motion cards, meet & confer, productions, depositions. */
export const DiscoveryPane = memo(function DiscoveryPane({ editor }: PaneProps): React.JSX.Element {
  const discovery = editor.matter.discovery;
  const requests = discovery?.requests ?? [];
  const motions = discovery?.motions ?? [];
  const meetConfers = discovery?.meetAndConfers ?? [];
  const productions = discovery?.productions ?? [];
  const depositions = discovery?.depositions ?? [];
  const statusNote = discovery?.statusNote ?? '';

  const patchRecord =
    (
      key: 'requests' | 'motions' | 'meetAndConfers' | 'productions' | 'depositions',
      id: string
    ): Patch =>
    (patch) =>
      editor.updateRecord('discovery', key, id, patch);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Discovery</div>
        <InlineInput
          value={statusNote}
          onChange={(value) => editor.patchSection('discovery', { statusNote: value })}
          placeholder="Status note"
          size={12.5}
          bold
          color={statusNote ? ACCENT : undefined}
          flex
        />
      </div>

      <SectionHeader
        title="Requests"
        action={
          <AddButton
            label="+ Add request"
            onClick={() =>
              editor.addRecord('discovery', 'requests', { type: 'RFP', status: 'Draft' })
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
            gridTemplateColumns: REQUEST_GRID,
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
          {REQUEST_HEADERS.map((header, index) => (
            <span key={index}>{header}</span>
          ))}
        </div>
        {requests.length === 0 ? (
          <div style={{ padding: '8px 12px' }}>
            <EmptyLine>No requests yet.</EmptyLine>
          </div>
        ) : (
          requests.map((request) => {
            const patch = patchRecord('requests', request.id);
            return (
              <div
                key={request.id}
                style={{ padding: '6px 12px', borderBottom: `1px solid ${HAIRLINE}` }}
              >
                <div style={{ ...rowGrid(REQUEST_GRID), gap: 8 }}>
                  <span>
                    <ToneSelect
                      value={request.type}
                      onChange={(value) => patch({ type: value })}
                      options={REQUEST_TYPES}
                      plain
                      small
                    />
                  </span>
                  {REQUEST_CELLS.map((key) => (
                    <InlineInput
                      key={key}
                      value={request[key] ?? ''}
                      onChange={(value) => patch({ [key]: value })}
                      size={12}
                      negativeMargin
                    />
                  ))}
                  <span>
                    <ToneSelect
                      value={request.status ?? ''}
                      onChange={(value) => patch({ status: value })}
                      options={REQUEST_STATUSES}
                      pill
                      small
                    />
                  </span>
                  <DeleteButton
                    title="Delete request"
                    onClick={() => editor.removeRecord('discovery', 'requests', request.id)}
                  />
                </div>
                <DirInput value={request.dir ?? ''} onChange={(value) => patch({ dir: value })} />
              </div>
            );
          })
        )}
      </div>

      <SectionHeader
        title="Motions"
        action={
          <AddButton
            label="+ Add motion"
            onClick={() =>
              editor.addRecord('discovery', 'motions', { type: '', outcome: 'Pending' })
            }
          />
        }
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
        {motions.length === 0 ? (
          <EmptyLine>No motions yet.</EmptyLine>
        ) : (
          motions.map((motion) => (
            <MotionCard
              key={motion.id}
              motion={motion}
              patch={patchRecord('motions', motion.id)}
              onDelete={() => editor.removeRecord('discovery', 'motions', motion.id)}
            />
          ))
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={boxStyle}>
          <SectionHeader
            title="Meet & confer"
            action={
              <AddButton
                label="+ Add"
                onClick={() =>
                  editor.addRecord('discovery', 'meetAndConfers', {
                    method: 'Email',
                    outcome: 'Awaiting Response',
                  })
                }
              />
            }
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {meetConfers.length === 0 ? (
              <EmptyLine>No meet and confer efforts yet.</EmptyLine>
            ) : (
              meetConfers.map((mc) => (
                <MeetConferEntry
                  key={mc.id}
                  mc={mc}
                  patch={patchRecord('meetAndConfers', mc.id)}
                  onDelete={() => editor.removeRecord('discovery', 'meetAndConfers', mc.id)}
                />
              ))
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={boxStyle}>
            <SectionHeader
              title="Productions"
              action={
                <AddButton
                  label="+ Add"
                  onClick={() => editor.addRecord('discovery', 'productions', { type: 'Initial' })}
                />
              }
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {productions.length === 0 ? (
                <EmptyLine>No productions yet.</EmptyLine>
              ) : (
                productions.map((production) => (
                  <ProductionRow
                    key={production.id}
                    production={production}
                    patch={patchRecord('productions', production.id)}
                    onDelete={() => editor.removeRecord('discovery', 'productions', production.id)}
                  />
                ))
              )}
            </div>
          </div>

          <div style={boxStyle}>
            <SectionHeader
              title="Depositions"
              action={
                <AddButton
                  label="+ Add"
                  onClick={() =>
                    editor.addRecord('discovery', 'depositions', {
                      name: '',
                      review: 'Not Started',
                    })
                  }
                />
              }
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {depositions.length === 0 ? (
                <EmptyLine>No depositions yet.</EmptyLine>
              ) : (
                depositions.map((deposition) => (
                  <DepositionRow
                    key={deposition.id}
                    deposition={deposition}
                    patch={patchRecord('depositions', deposition.id)}
                    onDelete={() => editor.removeRecord('discovery', 'depositions', deposition.id)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
