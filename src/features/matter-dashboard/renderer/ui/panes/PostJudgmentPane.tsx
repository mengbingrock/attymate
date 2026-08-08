import { memo } from 'react';

import {
  AddButton,
  DeleteButton,
  FieldLabel,
  InlineInput,
  SectionHeader,
  ToneSelect,
} from '../fieldPrimitives';
import { BODY, ENFORCEMENT_STATUSES, FAINT, JUDGMENT_STATUSES, MUTED } from '../matterTheme';

import type { MatterEditor } from '../../hooks/useMatterEditor';

export interface PaneProps {
  editor: MatterEditor;
}

const ACTION_GRID = '0.8fr 1fr 1.7fr 1.2fr 20px';

const PJ_FIELDS = [
  ['Entered', 'judgmentDate'],
  ['Amount', 'judgmentAmount'],
  ['Interest accruing', 'interest'],
  ['Satisfaction', 'satisfaction'],
] as const;

export const PostJudgmentPane = memo(function PostJudgmentPane({
  editor,
}: PaneProps): React.JSX.Element {
  const postJudgment = editor.matter.postJudgment;
  const actions = postJudgment?.enforcementActions ?? [];
  const judgmentStatus = postJudgment?.judgmentStatus ?? 'Not Entered';

  const patch = (id: string, changes: Record<string, unknown>): void => {
    editor.updateRecord('postJudgment', 'enforcementActions', id, changes);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Post-Judgment Enforcement</div>
        <div style={{ fontSize: 12.5, color: MUTED }}>
          {judgmentStatus === 'Not Entered' ? 'not started' : judgmentStatus}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '14px 20px',
          marginBottom: 18,
        }}
      >
        <div>
          <FieldLabel>Judgment status</FieldLabel>
          <ToneSelect
            options={JUDGMENT_STATUSES}
            value={judgmentStatus}
            onChange={(v) => editor.patchSection('postJudgment', { judgmentStatus: v })}
          />
        </div>
        <div>
          <FieldLabel>Enforcement status</FieldLabel>
          <ToneSelect
            options={ENFORCEMENT_STATUSES}
            value={postJudgment?.enforcementStatus ?? 'Not Started'}
            onChange={(v) => editor.patchSection('postJudgment', { enforcementStatus: v })}
          />
        </div>
        {PJ_FIELDS.map(([label, key]) => (
          <div key={key}>
            <FieldLabel>{label}</FieldLabel>
            <InlineInput
              negativeMargin
              size={13}
              value={postJudgment?.[key] ?? ''}
              onChange={(v) => editor.patchSection('postJudgment', { [key]: v })}
            />
          </div>
        ))}
      </div>

      <SectionHeader
        title="Enforcement actions"
        action={
          <AddButton
            label="+ Add action"
            onClick={() => editor.addRecord('postJudgment', 'enforcementActions', { action: '' })}
          />
        }
      />
      {actions.length === 0 ? (
        <div style={{ fontSize: 12, color: FAINT, lineHeight: 1.5, marginBottom: 10 }}>
          No actions recorded. This stage becomes active once judgment is entered; renewal,
          abstract, levy and examination deadlines are then tracked here.
        </div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {actions.map((a) => (
          <div
            key={a.id}
            style={{
              display: 'grid',
              gridTemplateColumns: ACTION_GRID,
              gap: 8,
              alignItems: 'center',
              fontSize: 12,
            }}
          >
            <InlineInput
              negativeMargin
              size={12}
              color={BODY}
              value={a.date ?? ''}
              placeholder="Date"
              onChange={(v) => patch(a.id, { date: v })}
            />
            <InlineInput
              negativeMargin
              size={12}
              bold
              value={a.action ?? ''}
              placeholder="Action"
              onChange={(v) => patch(a.id, { action: v })}
            />
            <InlineInput
              negativeMargin
              size={12}
              color={BODY}
              value={a.detail ?? ''}
              placeholder="Detail"
              onChange={(v) => patch(a.id, { detail: v })}
            />
            <ToneSelect
              plain
              small
              options={ENFORCEMENT_STATUSES}
              value={a.status ?? 'Not Started'}
              onChange={(v) => patch(a.id, { status: v })}
            />
            <DeleteButton
              title="Delete action"
              onClick={() => editor.removeRecord('postJudgment', 'enforcementActions', a.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
});
