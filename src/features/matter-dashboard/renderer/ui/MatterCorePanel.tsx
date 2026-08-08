import { memo } from 'react';

import { Card, InlineInput, PanelTitle } from './fieldPrimitives';
import { ACCENT, BORDER, DIM, FAINT, HAIRLINE, INK, MUTED, PANEL_BG, RED } from './matterTheme';

import type { MatterEditor } from '../hooks/useMatterEditor';

interface CoreFieldSpec {
  label: string;
  required?: boolean;
  /** List-view scalar mirrored from this field so search stays fresh. */
  scalar?: 'caption' | 'client' | 'caseNumber' | 'department';
}

const CORE_FIELDS: readonly CoreFieldSpec[] = [
  { label: 'Matter name', required: true, scalar: 'caption' },
  { label: 'Client', scalar: 'client' },
  { label: 'Client ID' },
  { label: 'Matter No.' },
  { label: 'Case No.', scalar: 'caseNumber' },
  { label: 'Court' },
  { label: 'Department', scalar: 'department' },
  { label: 'Court location' },
  { label: 'Judge' },
  { label: 'Court contact' },
  { label: 'Clerk' },
  { label: 'Dept. rules' },
  { label: 'Jurisdiction' },
  { label: 'Opened' },
  { label: 'Closed' },
  { label: 'Docs workspace', required: true },
];

function coreValue(editor: MatterEditor, label: string): string {
  const lower = label.toLowerCase();
  return (
    editor.matter.coreFields?.find((field) => field.label.toLowerCase() === lower)?.value ?? ''
  );
}

export interface MatterCorePanelProps {
  editor: MatterEditor;
  showRequiredMarkers: boolean;
}

/** Core matter facts (editable) plus read-only system fields. */
export const MatterCorePanel = memo(function MatterCorePanel({
  editor,
  showRequiredMarkers,
}: MatterCorePanelProps): React.JSX.Element {
  const systemFields = editor.matter.systemFields ?? [];
  return (
    <Card>
      <PanelTitle>Core</PanelTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {CORE_FIELDS.map((field) => {
          const value = coreValue(editor, field.label);
          return (
            <div
              key={field.label}
              style={{
                display: 'grid',
                gridTemplateColumns: '118px 1fr',
                gap: 8,
                alignItems: 'center',
                fontSize: 12.5,
              }}
            >
              <span style={{ color: MUTED }}>
                {field.label}
                {showRequiredMarkers && field.required && (
                  <span title="Required field" style={{ color: ACCENT, fontWeight: 700 }}>
                    {' '}
                    *
                  </span>
                )}
              </span>
              <InlineInput
                value={value}
                onChange={(next) => {
                  editor.setFieldValue('coreFields', field.label, next);
                  if (field.scalar) editor.setScalar(field.scalar, next);
                }}
                negativeMargin
                color={value ? INK : DIM}
              />
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${HAIRLINE}` }}>
        <PanelTitle>System · read only</PanelTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {systemFields.length === 0 && (
            <div style={{ fontSize: 11.5, color: FAINT }}>No system fields yet.</div>
          )}
          {systemFields.map((field) => (
            <div
              key={field.label}
              style={{
                display: 'grid',
                gridTemplateColumns: '118px 1fr',
                gap: 8,
                fontSize: 12,
                color: MUTED,
              }}
            >
              <span>{field.label}</span>
              <span
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: 11.5,
                  overflowWrap: 'anywhere',
                }}
              >
                {field.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
});

/** Standalone next-deadline callout; red-toned while a deadline is set. */
export const NextDeadlineCard = memo(function NextDeadlineCard({
  editor,
}: {
  editor: MatterEditor;
}): React.JSX.Element {
  const deadline = editor.matter.nextDeadline;
  const hot = Boolean(deadline?.date || deadline?.label);
  const fg = hot ? RED : MUTED;
  return (
    <div
      style={{
        background: hot ? 'oklch(0.97 0.02 27)' : PANEL_BG,
        border: `1px solid ${hot ? 'oklch(0.9 0.04 27)' : BORDER}`,
        borderRadius: 14,
        padding: '14px 18px',
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
          color: fg,
          marginBottom: 5,
        }}
      >
        Next deadline
      </div>
      <InlineInput
        value={deadline?.label ?? ''}
        onChange={(label) => editor.setNextDeadline({ label })}
        placeholder="What is due"
        size={13}
        bold
        negativeMargin
      />
      <div style={{ marginTop: 4 }}>
        <InlineInput
          value={deadline?.date ?? ''}
          onChange={(date) => editor.setNextDeadline({ date })}
          placeholder="When · verified how"
          size={11.5}
          color={deadline?.date ? fg : undefined}
          negativeMargin
        />
      </div>
    </div>
  );
});
