import { memo } from 'react';

import { ACCENT, ACCENT_FAINT_BG, BODY, BORDER, INK, MUTED } from './matterTheme';

import type { MatterDto, MatterStageId } from '../../contracts/dto';

const STAGE_ORDER: readonly MatterStageId[] = [
  'pleading',
  'discovery',
  'trial',
  'settlement',
  'post',
];

const STAGE_LABELS: Record<MatterStageId, string> = {
  pleading: 'Pleading',
  discovery: 'Discovery',
  trial: 'Trial',
  settlement: 'Settlement & Mediation',
  post: 'Post-Judgment',
};

export interface StageRailProps {
  matter: MatterDto;
  activeStage: MatterStageId;
  onSelectStage(stage: MatterStageId): void;
}

function stageSummary(matter: MatterDto, id: MatterStageId): string {
  switch (id) {
    case 'pleading': {
      const records = matter.pleading?.records?.length ?? 0;
      const parties = matter.parties?.length ?? 0;
      return `${records} records · ${parties} parties`;
    }
    case 'discovery': {
      const requests = matter.discovery?.requests?.length ?? 0;
      const motions = matter.discovery?.motions?.length ?? 0;
      return `${requests} requests · ${motions} motions`;
    }
    case 'trial': {
      const setting = matter.trial?.settings?.[0];
      const parts: string[] = [];
      if (setting) {
        parts.push(setting.type ?? 'Trial');
        if (setting.days) parts.push(`est. ${setting.days} days`);
      }
      const continuances = matter.trial?.continuances?.length ?? 0;
      if (continuances > 0) {
        parts.push(`${continuances} continuance${continuances === 1 ? '' : 's'}`);
      }
      return parts.length > 0 ? parts.join(' · ') : '—';
    }
    case 'settlement': {
      const records = matter.settlement?.records?.length ?? 0;
      const mediations = matter.settlement?.mediations?.length ?? 0;
      return `${records} records · ${mediations} mediations`;
    }
    case 'post':
      return matter.postJudgment?.judgmentStatus || 'Not started';
  }
}

/** Vertical case-stage timeline; click selects the pane to show. */
export const StageRail = memo(function StageRail({
  matter,
  activeStage,
  onSelectStage,
}: StageRailProps): React.JSX.Element {
  const currentStage = matter.currentStage ?? 'discovery';
  const currentIndex = STAGE_ORDER.indexOf(currentStage);
  const settlementHasRecords =
    (matter.settlement?.records?.length ?? 0) > 0 ||
    (matter.settlement?.mediations?.length ?? 0) > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {STAGE_ORDER.map((id, index) => {
        const done = index < currentIndex;
        const current = index === currentIndex;
        const active = activeStage === id;
        const status = done
          ? 'Completed'
          : current
            ? 'In progress'
            : id === 'settlement' && settlementHasRecords
              ? 'Running in parallel'
              : 'Upcoming';
        const dates = matter.stages?.find((stage) => stage.id === id)?.dates ?? '—';
        return (
          <div
            key={id}
            onClick={() => onSelectStage(id)}
            className="hover:bg-[#f4f5f8]"
            style={{
              display: 'flex',
              gap: 11,
              cursor: 'pointer',
              padding: '9px 12px',
              borderRadius: 10,
              background: active ? ACCENT_FAINT_BG : undefined,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span
                style={{
                  width: 21,
                  height: 21,
                  borderRadius: 99,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10.5,
                  fontWeight: 700,
                  background: done ? INK : current ? ACCENT : '#d6dae2',
                  color: done || current ? '#fff' : BODY,
                  flexShrink: 0,
                }}
              >
                {done ? '✓' : String(index + 1)}
              </span>
              <span
                style={{
                  width: 2,
                  flex: 1,
                  background: done ? INK : BORDER,
                  borderRadius: 2,
                  minHeight: 12,
                }}
              />
            </div>
            <div style={{ paddingBottom: 8 }}>
              <div
                style={{ fontSize: 13.5, fontWeight: 600, color: done || current ? INK : MUTED }}
              >
                {STAGE_LABELS[id]}
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: current ? ACCENT : MUTED }}>
                {status}
              </div>
              <div style={{ fontSize: 11.5, color: MUTED }}>{dates}</div>
              <div style={{ fontSize: 11.5, color: BODY, marginTop: 2 }}>
                {stageSummary(matter, id)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});
