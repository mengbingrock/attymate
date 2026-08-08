import { memo, useMemo, useState } from 'react';

import { deriveProceduralEvents } from '../../core/domain/proceduralHistory';

import { Card, DeleteButton, InlineInput, ToneSelect } from './fieldPrimitives';
import {
  ACCENT,
  ACCENT_BG,
  ACCENT_DARK,
  BODY,
  BORDER,
  EVENT_GROUPS,
  EVENT_TYPES,
  FAINT,
  HAIRLINE,
  INK,
  MUTED,
  toneFor,
} from './matterTheme';

import type { MatterEventView } from '../../core/domain/proceduralHistory';
import type { MatterEditor } from '../hooks/useMatterEditor';

const GRID_COLUMNS = '118px 138px 1fr 172px 26px';

const sourceTagStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  padding: '2px 6px',
  borderRadius: 6,
};

const StaticPill = ({ value, round }: { value: string; round?: boolean }): React.JSX.Element => {
  const tone = toneFor(value);
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: round ? 11 : 10.5,
        fontWeight: 600,
        padding: '2px 6px',
        borderRadius: round ? 99 : 6,
        border: `1px solid ${BORDER}`,
        background: tone.bg,
        color: tone.fg,
      }}
    >
      {value}
    </span>
  );
};

/** Merged auto + manual timeline; only manual rows are editable. */
export const ProceduralHistoryView = memo(function ProceduralHistoryView({
  editor,
}: {
  editor: MatterEditor;
}): React.JSX.Element {
  const [group, setGroup] = useState<string>('All');
  const events = useMemo(() => deriveProceduralEvents(editor.matter), [editor.matter]);
  const visible = group === 'All' ? events : events.filter((event) => event.group === group);
  const manualCount = events.filter((event) => event.sync === 'manual').length;
  const chips = ['All', ...EVENT_GROUPS];

  const patch = (event: MatterEventView, changes: Record<string, unknown>): void => {
    editor.updateRecord('events', null, event.id, changes);
  };

  return (
    <Card padding="20px 24px 26px">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Procedural History</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>
            {events.length} events · {manualCount} manual
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {chips.map((chip) => {
              const on = group === chip;
              return (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setGroup(chip)}
                  style={{
                    font: 'inherit',
                    fontSize: 11.5,
                    fontWeight: 600,
                    padding: '4px 11px',
                    borderRadius: 99,
                    cursor: 'pointer',
                    border: `1px solid ${on ? INK : '#d6dae2'}`,
                    background: on ? INK : '#fff',
                    color: on ? '#fff' : BODY,
                  }}
                >
                  {chip}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() =>
              editor.addRecord('events', null, { date: '', type: 'Other', group: 'Core' })
            }
            className="hover:bg-black"
            style={{
              font: 'inherit',
              fontSize: 12,
              fontWeight: 600,
              padding: '5px 12px',
              borderRadius: 8,
              border: `1px solid ${INK}`,
              background: INK,
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            + Add event
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: GRID_COLUMNS,
          gap: 10,
          padding: '0 12px 8px',
          borderBottom: `1px solid ${BORDER}`,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: MUTED,
        }}
      >
        <span>Date</span>
        <span>Type · Group</span>
        <span>Event</span>
        <span>Source</span>
        <span />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {visible.map((event) => {
          const manual = event.sync === 'manual';
          return (
            <div
              key={event.id}
              style={{
                display: 'grid',
                gridTemplateColumns: GRID_COLUMNS,
                gap: 10,
                padding: '10px 12px',
                borderBottom: `1px solid ${HAIRLINE}`,
                fontSize: 12.5,
                alignItems: 'start',
              }}
            >
              {manual ? (
                <>
                  <div>
                    <InlineInput
                      value={event.date}
                      onChange={(date) => patch(event, { date })}
                      placeholder="Date"
                      bold
                      negativeMargin
                    />
                    <InlineInput
                      value={event.time ?? ''}
                      onChange={(time) => patch(event, { time })}
                      placeholder="Time"
                      size={11}
                      color={event.time ? MUTED : FAINT}
                      negativeMargin
                    />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      alignItems: 'flex-start',
                    }}
                  >
                    <ToneSelect
                      value={event.type}
                      onChange={(type) => patch(event, { type })}
                      options={EVENT_TYPES}
                      pill
                      small
                    />
                    <ToneSelect
                      value={event.group}
                      onChange={(next) => patch(event, { group: next })}
                      options={EVENT_GROUPS}
                      plain
                      small
                    />
                  </div>
                  <div>
                    <InlineInput
                      value={event.description}
                      onChange={(description) => patch(event, { description })}
                      placeholder="What happened"
                      negativeMargin
                    />
                    <InlineInput
                      value={event.parties ?? ''}
                      onChange={(parties) => patch(event, { parties })}
                      placeholder="Related parties"
                      size={11.5}
                      color={event.parties ? MUTED : FAINT}
                      negativeMargin
                    />
                    <InlineInput
                      value={event.docs ?? ''}
                      onChange={(docs) => patch(event, { docs })}
                      placeholder="Related documents"
                      size={11.5}
                      color={event.docs ? ACCENT : FAINT}
                      negativeMargin
                    />
                    <InlineInput
                      value={event.note ?? ''}
                      onChange={(note) => patch(event, { note })}
                      placeholder="Note"
                      size={11.5}
                      color={event.note ? BODY : FAINT}
                      negativeMargin
                    />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                      alignItems: 'flex-start',
                    }}
                  >
                    <span
                      style={{
                        ...sourceTagStyle,
                        border: `1px solid ${BORDER}`,
                        background: '#fff',
                        color: MUTED,
                      }}
                    >
                      Manual
                    </span>
                    {event.sourceRef && (
                      <span style={{ fontSize: 11, color: MUTED }}>{event.sourceRef}</span>
                    )}
                  </div>
                  <DeleteButton
                    title="Delete event"
                    onClick={() => editor.removeRecord('events', null, event.id)}
                  />
                </>
              ) : (
                <>
                  <div>
                    <div style={{ fontWeight: 600 }}>{event.date}</div>
                    {event.time && <div style={{ fontSize: 11, color: FAINT }}>{event.time}</div>}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      alignItems: 'flex-start',
                    }}
                  >
                    <StaticPill value={event.type} round />
                    <StaticPill value={event.group} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, color: INK }}>{event.description}</div>
                    {event.parties && (
                      <div style={{ fontSize: 11.5, color: MUTED }}>{event.parties}</div>
                    )}
                    {event.docs && (
                      <div style={{ fontSize: 11.5, color: ACCENT }}>{event.docs}</div>
                    )}
                    {event.note && <div style={{ fontSize: 11.5, color: BODY }}>{event.note}</div>}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                      alignItems: 'flex-start',
                    }}
                  >
                    <span style={{ ...sourceTagStyle, background: ACCENT_BG, color: ACCENT_DARK }}>
                      Auto
                    </span>
                    {event.sourceRef && (
                      <span
                        style={{
                          fontSize: 11,
                          color: MUTED,
                          fontFamily: 'ui-monospace, monospace',
                        }}
                      >
                        {event.sourceRef}
                      </span>
                    )}
                  </div>
                  <span />
                </>
              )}
            </div>
          );
        })}
        {visible.length === 0 && (
          <div style={{ padding: '18px 12px', fontSize: 12.5, color: FAINT }}>No events yet.</div>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: FAINT, marginTop: 14, lineHeight: 1.5 }}>
        Auto entries derive from the stage records — editing the source record updates the timeline.
        Manual entries belong to whoever entered them.
      </div>
    </Card>
  );
});
