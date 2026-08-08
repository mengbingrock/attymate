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
  BODY,
  BORDER,
  EXHIBIT_ADMISSIONS,
  EXHIBIT_FOUNDATIONS,
  FAINT,
  HAIRLINE,
  MIL_OUTCOMES,
  MUTED,
  PANEL_BG,
  PRETRIAL_STATUSES,
  TRIAL_SETTING_STATUSES,
  TRIAL_TYPES,
  WITNESS_AVAILABILITIES,
  WITNESS_ROLES,
} from '../matterTheme';

import type { MatterEditor } from '../../hooks/useMatterEditor';

export interface PaneProps {
  editor: MatterEditor;
}

const SETTINGS_GRID = '0.9fr 0.9fr 0.9fr 0.7fr 1.4fr 1fr 26px';
const DEADLINE_GRID = '1.7fr 0.9fr 1fr 22px';
const FILING_GRID = '1.6fr 0.8fr 0.8fr 0.9fr 22px';
const MIL_GRID = '0.5fr 2fr 0.8fr 0.8fr 0.8fr 1fr 22px';

const BOX: React.CSSProperties = {
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  overflow: 'hidden',
};

const PADDED_BOX: React.CSSProperties = {
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  padding: '13px 15px',
};

const tableHead = (grid: string): React.CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: grid,
  gap: 8,
  padding: '8px 12px',
  background: PANEL_BG,
  borderBottom: `1px solid ${BORDER}`,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: MUTED,
});

const tableRow = (grid: string): React.CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: grid,
  gap: 8,
  alignItems: 'center',
  padding: '6px 12px',
  borderBottom: `1px solid ${HAIRLINE}`,
  fontSize: 12,
});

interface StackedFieldView {
  key: string;
  value: string;
  placeholder: string;
}

interface StackedRecordView {
  id: string;
  head: StackedFieldView;
  fields: StackedFieldView[];
}

/** Boxed mini-section (sessions / verdict / post-trial motions): a bold head
 * field + delete per record, then stacked free-text rows. */
const StackedRecordsBox = ({
  title,
  emptyText,
  deleteTitle,
  records,
  onAdd,
  onPatch,
  onRemove,
}: {
  title: string;
  emptyText: string;
  deleteTitle: string;
  records: StackedRecordView[];
  onAdd: () => void;
  onPatch: (id: string, key: string, value: string) => void;
  onRemove: (id: string) => void;
}): React.JSX.Element => (
  <div style={PADDED_BOX}>
    <SectionHeader title={title} action={<AddButton label="+ Add" onClick={onAdd} />} />
    {records.length === 0 ? (
      <div style={{ fontSize: 11.5, color: FAINT, lineHeight: 1.5 }}>{emptyText}</div>
    ) : null}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {records.map((record) => (
        <div key={record.id} style={{ borderTop: `1px solid ${HAIRLINE}`, paddingTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <InlineInput
              flex
              bold
              negativeMargin
              size={12}
              value={record.head.value}
              placeholder={record.head.placeholder}
              onChange={(v) => onPatch(record.id, record.head.key, v)}
            />
            <DeleteButton title={deleteTitle} onClick={() => onRemove(record.id)} />
          </div>
          {record.fields.map((field) => (
            <InlineInput
              key={field.key}
              negativeMargin
              size={11.5}
              color={BODY}
              value={field.value}
              placeholder={field.placeholder}
              onChange={(v) => onPatch(record.id, field.key, v)}
            />
          ))}
        </div>
      ))}
    </div>
  </div>
);

export const TrialPane = memo(function TrialPane({ editor }: PaneProps): React.JSX.Element {
  const trial = editor.matter.trial;
  const settings = trial?.settings ?? [];
  const continuances = trial?.continuances ?? [];
  const pretrialDeadlines = trial?.pretrialDeadlines ?? [];
  const pretrialFilings = trial?.pretrialFilings ?? [];
  const witnesses = trial?.witnesses ?? [];
  const exhibits = trial?.exhibits ?? [];
  const mils = trial?.motionsInLimine ?? [];
  const trialDate = settings[0]?.trialDate;

  const patch = (key: string, id: string, changes: Record<string, unknown>): void => {
    editor.updateRecord('trial', key, id, changes);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Trial</div>
        {trialDate ? <div style={{ fontSize: 12.5, color: MUTED }}>set for {trialDate}</div> : null}
      </div>

      <SectionHeader
        title="Settings"
        action={
          <div style={{ display: 'flex', gap: 7 }}>
            <AddButton
              label="+ Add setting"
              onClick={() =>
                editor.addRecord('trial', 'settings', { type: 'Jury Trial', status: 'Set' })
              }
            />
            <AddButton
              label="+ Add continuance"
              onClick={() => editor.addRecord('trial', 'continuances', { text: '' })}
            />
          </div>
        }
      />
      <div style={{ ...BOX, marginBottom: 18 }}>
        <div style={tableHead(SETTINGS_GRID)}>
          <span>Type</span>
          <span>Set on</span>
          <span>Trial date</span>
          <span>Est. days</span>
          <span>Venue</span>
          <span>Status</span>
          <span />
        </div>
        {settings.map((s) => (
          <div key={s.id} style={tableRow(SETTINGS_GRID)}>
            <span>
              <ToneSelect
                plain
                small
                options={TRIAL_TYPES}
                value={s.type ?? 'Jury Trial'}
                onChange={(v) => patch('settings', s.id, { type: v })}
              />
            </span>
            <InlineInput
              negativeMargin
              size={12}
              value={s.setAt ?? ''}
              onChange={(v) => patch('settings', s.id, { setAt: v })}
            />
            <InlineInput
              negativeMargin
              size={12}
              bold={s.status === 'Set' || s.status === 'Confirmed'}
              value={s.trialDate ?? ''}
              onChange={(v) => patch('settings', s.id, { trialDate: v })}
            />
            <InlineInput
              negativeMargin
              size={12}
              value={s.days ?? ''}
              onChange={(v) => patch('settings', s.id, { days: v })}
            />
            <InlineInput
              negativeMargin
              size={12}
              value={s.venue ?? ''}
              onChange={(v) => patch('settings', s.id, { venue: v })}
            />
            <span>
              <ToneSelect
                pill
                small
                options={TRIAL_SETTING_STATUSES}
                value={s.status ?? 'Set'}
                onChange={(v) => patch('settings', s.id, { status: v })}
              />
            </span>
            <DeleteButton
              title="Delete setting"
              onClick={() => editor.removeRecord('trial', 'settings', s.id)}
            />
          </div>
        ))}
        {continuances.map((c) => (
          <div
            key={c.id}
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              padding: '6px 12px',
              borderBottom: `1px solid ${HAIRLINE}`,
              fontSize: 12,
              background: '#fbfbfc',
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: MUTED,
                flexShrink: 0,
              }}
            >
              Continuance
            </span>
            <InlineInput
              flex
              size={12}
              color={BODY}
              value={c.text}
              placeholder="Requested by · original date → new date · ruling · reason"
              onChange={(v) => patch('continuances', c.id, { text: v })}
            />
            <DeleteButton
              title="Delete continuance"
              onClick={() => editor.removeRecord('trial', 'continuances', c.id)}
            />
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
        <div>
          <SectionHeader
            title="Pretrial deadlines"
            action={
              <AddButton
                label="+ Add"
                onClick={() =>
                  editor.addRecord('trial', 'pretrialDeadlines', {
                    title: '',
                    status: 'Not Started',
                  })
                }
              />
            }
          />
          <div style={BOX}>
            {pretrialDeadlines.map((d) => (
              <div key={d.id} style={tableRow(DEADLINE_GRID)}>
                <InlineInput
                  negativeMargin
                  size={12}
                  bold
                  value={d.title}
                  placeholder="Deadline"
                  onChange={(v) => patch('pretrialDeadlines', d.id, { title: v })}
                />
                <div>
                  <InlineInput
                    negativeMargin
                    size={12}
                    color={BODY}
                    value={d.due ?? ''}
                    placeholder="Due"
                    onChange={(v) => patch('pretrialDeadlines', d.id, { due: v })}
                  />
                  <InlineInput
                    negativeMargin
                    size={10.5}
                    color={FAINT}
                    value={d.source ?? ''}
                    placeholder="Source"
                    onChange={(v) => patch('pretrialDeadlines', d.id, { source: v })}
                  />
                </div>
                <span>
                  <ToneSelect
                    plain
                    small
                    options={PRETRIAL_STATUSES}
                    value={d.status ?? 'Not Started'}
                    onChange={(v) => patch('pretrialDeadlines', d.id, { status: v })}
                  />
                </span>
                <DeleteButton
                  title="Delete deadline"
                  onClick={() => editor.removeRecord('trial', 'pretrialDeadlines', d.id)}
                />
              </div>
            ))}
          </div>
        </div>
        <div>
          <SectionHeader
            title="Pretrial filings"
            action={
              <AddButton
                label="+ Add"
                onClick={() => editor.addRecord('trial', 'pretrialFilings', { title: '' })}
              />
            }
          />
          <div style={BOX}>
            {pretrialFilings.map((f) => (
              <div
                key={f.id}
                style={{ padding: '6px 12px', borderBottom: `1px solid ${HAIRLINE}` }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: FILING_GRID,
                    gap: 8,
                    alignItems: 'center',
                    fontSize: 12,
                  }}
                >
                  <InlineInput
                    negativeMargin
                    size={12}
                    bold
                    value={f.title}
                    placeholder="Filing"
                    onChange={(v) => patch('pretrialFilings', f.id, { title: v })}
                  />
                  <InlineInput
                    negativeMargin
                    size={12}
                    color={BODY}
                    value={f.party ?? ''}
                    placeholder="Party"
                    onChange={(v) => patch('pretrialFilings', f.id, { party: v })}
                  />
                  <InlineInput
                    negativeMargin
                    size={12}
                    color={BODY}
                    value={f.due ?? ''}
                    placeholder="Due"
                    onChange={(v) => patch('pretrialFilings', f.id, { due: v })}
                  />
                  <InlineInput
                    negativeMargin
                    size={12}
                    color={BODY}
                    value={f.filed ?? ''}
                    placeholder="Filed"
                    onChange={(v) => patch('pretrialFilings', f.id, { filed: v })}
                  />
                  <DeleteButton
                    title="Delete filing"
                    onClick={() => editor.removeRecord('trial', 'pretrialFilings', f.id)}
                  />
                </div>
                <DirInput
                  value={f.dir ?? ''}
                  onChange={(v) => patch('pretrialFilings', f.id, { dir: v })}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
        <div style={PADDED_BOX}>
          <SectionHeader
            title="Witnesses"
            action={
              <AddButton
                label="+ Add"
                onClick={() =>
                  editor.addRecord('trial', 'witnesses', {
                    name: '',
                    role: 'Fact',
                    availability: 'Unknown',
                  })
                }
              />
            }
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {witnesses.map((w) => (
              <div key={w.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <InlineInput
                    negativeMargin
                    size={12}
                    bold
                    width={104}
                    value={w.name}
                    placeholder="Witness"
                    onChange={(v) => patch('witnesses', w.id, { name: v })}
                  />
                  <ToneSelect
                    plain
                    small
                    options={WITNESS_ROLES}
                    value={w.role ?? 'Fact'}
                    onChange={(v) => patch('witnesses', w.id, { role: v })}
                  />
                  <InlineInput
                    size={11.5}
                    width={76}
                    color={MUTED}
                    value={w.party ?? ''}
                    placeholder="Party"
                    onChange={(v) => patch('witnesses', w.id, { party: v })}
                  />
                  <ToneSelect
                    pill
                    small
                    options={WITNESS_AVAILABILITIES}
                    value={w.availability ?? 'Unknown'}
                    onChange={(v) => patch('witnesses', w.id, { availability: v })}
                  />
                  <div style={{ marginLeft: 'auto' }}>
                    <DeleteButton
                      title="Delete witness"
                      onClick={() => editor.removeRecord('trial', 'witnesses', w.id)}
                    />
                  </div>
                </div>
                <InlineInput
                  negativeMargin
                  size={11.5}
                  color={BODY}
                  value={w.topics ?? ''}
                  placeholder="Topics, availability"
                  onChange={(v) => patch('witnesses', w.id, { topics: v })}
                />
                <InlineInput
                  negativeMargin
                  size={11}
                  color={FAINT}
                  value={w.docs ?? ''}
                  placeholder="Disclosure, subpoena, outlines"
                  onChange={(v) => patch('witnesses', w.id, { docs: v })}
                />
              </div>
            ))}
          </div>
        </div>
        <div style={PADDED_BOX}>
          <SectionHeader
            title="Exhibits"
            action={
              <AddButton
                label="+ Add"
                onClick={() =>
                  editor.addRecord('trial', 'exhibits', {
                    number: '',
                    title: '',
                    admission: 'Proposed',
                  })
                }
              />
            }
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {exhibits.map((x) => (
              <div key={x.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <InlineInput
                    negativeMargin
                    mono
                    bold
                    size={12}
                    width={46}
                    color={MUTED}
                    value={x.number}
                    placeholder="No."
                    onChange={(v) => patch('exhibits', x.id, { number: v })}
                  />
                  <InlineInput
                    flex
                    bold
                    size={12}
                    value={x.title}
                    placeholder="Exhibit title"
                    onChange={(v) => patch('exhibits', x.id, { title: v })}
                  />
                  <ToneSelect
                    pill
                    small
                    options={EXHIBIT_ADMISSIONS}
                    value={x.admission ?? 'Proposed'}
                    onChange={(v) => patch('exhibits', x.id, { admission: v })}
                  />
                  <DeleteButton
                    title="Delete exhibit"
                    onClick={() => editor.removeRecord('trial', 'exhibits', x.id)}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 3 }}>
                  <ToneSelect
                    plain
                    small
                    options={EXHIBIT_FOUNDATIONS}
                    value={x.foundation ?? 'In Progress'}
                    onChange={(v) => patch('exhibits', x.id, { foundation: v })}
                  />
                  <InlineInput
                    flex
                    size={11.5}
                    color={BODY}
                    value={x.objections ?? ''}
                    placeholder="Objections, ruling"
                    onChange={(v) => patch('exhibits', x.id, { objections: v })}
                  />
                  <div style={{ flex: '0 1 108px', minWidth: 0 }}>
                    <DirInput
                      value={x.dir ?? ''}
                      placeholder="/ workspace"
                      onChange={(v) => patch('exhibits', x.id, { dir: v })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <SectionHeader
        title="Motions in limine"
        action={
          <AddButton
            label="+ Add MIL"
            onClick={() =>
              editor.addRecord('trial', 'motionsInLimine', { number: '', outcome: 'Pending' })
            }
          />
        }
      />
      <div style={{ ...BOX, marginBottom: 16 }}>
        {mils.map((m) => (
          <div key={m.id} style={{ padding: '6px 12px', borderBottom: `1px solid ${HAIRLINE}` }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: MIL_GRID,
                gap: 8,
                alignItems: 'center',
                fontSize: 12,
              }}
            >
              <InlineInput
                negativeMargin
                size={12}
                value={m.number ?? ''}
                placeholder="No."
                onChange={(v) => patch('motionsInLimine', m.id, { number: v })}
              />
              <InlineInput
                negativeMargin
                size={12}
                bold
                value={m.issue ?? ''}
                placeholder="Issue"
                onChange={(v) => patch('motionsInLimine', m.id, { issue: v })}
              />
              <InlineInput
                negativeMargin
                size={12}
                color={BODY}
                value={m.party ?? ''}
                placeholder="Party"
                onChange={(v) => patch('motionsInLimine', m.id, { party: v })}
              />
              <InlineInput
                negativeMargin
                size={12}
                color={BODY}
                value={m.filed ?? ''}
                placeholder="Filed"
                onChange={(v) => patch('motionsInLimine', m.id, { filed: v })}
              />
              <InlineInput
                negativeMargin
                size={12}
                color={BODY}
                value={m.hearing ?? ''}
                placeholder="Hearing"
                onChange={(v) => patch('motionsInLimine', m.id, { hearing: v })}
              />
              <span>
                <ToneSelect
                  pill
                  small
                  options={MIL_OUTCOMES}
                  value={m.outcome ?? 'Pending'}
                  onChange={(v) => patch('motionsInLimine', m.id, { outcome: v })}
                />
              </span>
              <DeleteButton
                title="Delete MIL"
                onClick={() => editor.removeRecord('trial', 'motionsInLimine', m.id)}
              />
            </div>
            <DirInput
              value={m.dir ?? ''}
              onChange={(v) => patch('motionsInLimine', m.id, { dir: v })}
            />
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        <StackedRecordsBox
          title="Trial sessions"
          emptyText="No sessions yet. Add a trial day to record witnesses, exhibits, bench rulings and the transcript."
          deleteTitle="Delete session"
          records={(trial?.sessions ?? []).map((s) => ({
            id: s.id,
            head: { key: 'date', value: s.date ?? '', placeholder: 'Date' },
            fields: [
              { key: 'witnesses', value: s.witnesses ?? '', placeholder: 'Witnesses called' },
              { key: 'rulings', value: s.rulings ?? '', placeholder: 'Bench rulings' },
              {
                key: 'transcript',
                value: s.transcript ?? '',
                placeholder: 'Transcript / exhibits admitted',
              },
            ],
          }))}
          onAdd={() => editor.addRecord('trial', 'sessions', { date: '' })}
          onPatch={(id, key, value) => patch('sessions', id, { [key]: value })}
          onRemove={(id) => editor.removeRecord('trial', 'sessions', id)}
        />
        <StackedRecordsBox
          title="Verdict"
          emptyText="Not entered. Add a record for the verdict date, result, damages and verdict form."
          deleteTitle="Delete verdict"
          records={(trial?.verdicts ?? []).map((v) => ({
            id: v.id,
            head: { key: 'date', value: v.date ?? '', placeholder: 'Entered' },
            fields: [
              { key: 'result', value: v.result ?? '', placeholder: 'Result' },
              { key: 'damages', value: v.damages ?? '', placeholder: 'Damages' },
              { key: 'form', value: v.form ?? '', placeholder: 'Verdict form' },
            ],
          }))}
          onAdd={() => editor.addRecord('trial', 'verdicts', { date: '' })}
          onPatch={(id, key, value) => patch('verdicts', id, { [key]: value })}
          onRemove={(id) => editor.removeRecord('trial', 'verdicts', id)}
        />
        <StackedRecordsBox
          title="Post-trial motions"
          emptyText="None. New trial, JNOV, costs and fees motions are tracked here after verdict."
          deleteTitle="Delete motion"
          records={(trial?.postTrialMotions ?? []).map((m) => ({
            id: m.id,
            head: { key: 'type', value: m.type, placeholder: 'Motion' },
            fields: [
              { key: 'filed', value: m.filed ?? '', placeholder: 'Filed' },
              { key: 'hearing', value: m.hearing ?? '', placeholder: 'Hearing' },
              { key: 'outcome', value: m.outcome ?? '', placeholder: 'Outcome' },
              { key: 'notes', value: m.notes ?? '', placeholder: 'Notes' },
            ],
          }))}
          onAdd={() => editor.addRecord('trial', 'postTrialMotions', { type: '' })}
          onPatch={(id, key, value) => patch('postTrialMotions', id, { [key]: value })}
          onRemove={(id) => editor.removeRecord('trial', 'postTrialMotions', id)}
        />
      </div>
    </div>
  );
});
