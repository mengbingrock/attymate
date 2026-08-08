import { memo, useCallback, useEffect, useState } from 'react';

import { useMatter } from '../hooks/useMatter';
import { useMatterEditor } from '../hooks/useMatterEditor';

import { DiscoveryPane } from './panes/DiscoveryPane';
import { PleadingPane } from './panes/PleadingPane';
import { PostJudgmentPane } from './panes/PostJudgmentPane';
import { SettlementPane } from './panes/SettlementPane';
import { TrialPane } from './panes/TrialPane';
import { DEMO_MATTER } from './demoFixture';
import { Card, ToneSelect } from './fieldPrimitives';
import { LinkEvidencePanel } from './LinkEvidencePanel';
import { MatterCorePanel, NextDeadlineCard } from './MatterCorePanel';
import { MattersListView } from './MattersListView';
import { ACCENT, BODY, BORDER, INK, MATTER_STATUSES, MUTED, RED } from './matterTheme';
import { PartiesPanel } from './PartiesPanel';
import { ProceduralHistoryView } from './ProceduralHistoryView';
import { ProposalReviewPanel } from './ProposalReviewPanel';
import { StageRail } from './StageRail';

import type { MatterDto, MatterStageId } from '../../contracts';
import type { UseMatterResult } from '../hooks/useMatter';

/**
 * Matter Dashboard — React port of the "Matter Dashboard v3" design
 * (`Matter Dashboard v3.dc.html`): a matters list over the app's global,
 * team-independent store, a two-column matter view with a five-stage rail
 * (incl. Settlement & Mediation) and a Parties & Counsel panel, and a
 * Procedural History timeline derived from the stage records.
 *
 * Inline edits persist: they write into the matter store as user-authored
 * changes (debounced per section). Team leads still propose via
 * matter_propose, gated by the review panel.
 */

const RESPONSIVE_CSS = `
@container matter-dashboard (max-width: 980px) {
  .matter-dashboard-columns { grid-template-columns: 1fr !important; }
  .matter-dashboard-stagegrid { grid-template-columns: 1fr !important; }
}
`;

interface MatterDashboardViewProps {
  /** Legacy prop; the stage now comes from the matter itself. */
  currentStage?: MatterStageId;
  /** Show required-field markers next to fields the intake contract requires. */
  showRequiredMarkers?: boolean;
  /** Team whose store snapshot drives the dashboard; absent renders the demo. */
  teamName?: string;
}

type ViewState = { kind: 'list' } | { kind: 'matter'; matterId: string; tab: 'matter' | 'history' };

export const MatterDashboardView = memo(function MatterDashboardView({
  showRequiredMarkers = true,
  teamName,
}: MatterDashboardViewProps): React.JSX.Element {
  const hook = useMatter(teamName);
  const live = Boolean(teamName);
  const matters = live ? hook.matters : [DEMO_MATTER];
  const linkedMatterIds = live ? hook.linkedMatterIds : [DEMO_MATTER.id];

  const [view, setView] = useState<ViewState>({ kind: 'list' });

  // A deleted or filtered-away matter drops back to the list.
  useEffect(() => {
    if (view.kind === 'matter' && !matters.some((matter) => matter.id === view.matterId)) {
      setView({ kind: 'list' });
    }
  }, [view, matters]);

  const openMatter = useCallback((matterId: string) => {
    setView({ kind: 'matter', matterId, tab: 'matter' });
  }, []);

  const createMatter = useCallback(() => {
    void hook.createMatter().then((created) => {
      if (created) setView({ kind: 'matter', matterId: created.id, tab: 'matter' });
    });
  }, [hook]);

  const selectedMatter =
    view.kind === 'matter' ? (matters.find((matter) => matter.id === view.matterId) ?? null) : null;

  return (
    <div
      style={{ containerType: 'inline-size', containerName: 'matter-dashboard' }}
      data-testid="matter-dashboard"
    >
      <style>{RESPONSIVE_CSS}</style>
      <div style={{ maxWidth: 1560, margin: '0 auto', padding: '20px 24px 48px' }}>
        {live && hook.loading ? (
          <div style={{ color: MUTED, fontSize: 13, padding: 24 }}>Loading matters…</div>
        ) : view.kind === 'list' || !selectedMatter ? (
          <>
            {hook.proposal && (
              <ProposalReviewPanel
                proposal={hook.proposal}
                matter={matters.find((matter) => matter.id === hook.proposal?.matterId) ?? null}
                acting={hook.acting}
                onApprove={hook.applyProposal}
                onReject={hook.rejectProposal}
              />
            )}
            {hook.error && (
              <div style={{ color: RED, fontSize: 12.5, marginBottom: 12 }}>{hook.error}</div>
            )}
            <MattersListView
              matters={matters}
              linkedMatterIds={linkedMatterIds}
              live={live}
              onOpen={openMatter}
              onCreate={createMatter}
              onLink={(matterId) => void hook.linkTeam(matterId)}
              onUnlink={(matterId) => void hook.unlinkTeam(matterId)}
            />
          </>
        ) : (
          <MatterWorkspace
            key={selectedMatter.id}
            teamName={teamName}
            matter={selectedMatter}
            tab={view.kind === 'matter' ? view.tab : 'matter'}
            onTab={(tab) => setView({ kind: 'matter', matterId: selectedMatter.id, tab })}
            onBack={() => setView({ kind: 'list' })}
            showRequiredMarkers={showRequiredMarkers}
            hook={hook}
          />
        )}
      </div>
    </div>
  );
});

interface MatterWorkspaceProps {
  readonly teamName: string | undefined;
  readonly matter: MatterDto;
  readonly tab: 'matter' | 'history';
  readonly onTab: (tab: 'matter' | 'history') => void;
  readonly onBack: () => void;
  readonly showRequiredMarkers: boolean;
  readonly hook: UseMatterResult;
}

const STAGE_ORDER: readonly MatterStageId[] = [
  'pleading',
  'discovery',
  'trial',
  'settlement',
  'post',
];

function MatterWorkspace({
  teamName,
  matter,
  tab,
  onTab,
  onBack,
  showRequiredMarkers,
  hook,
}: MatterWorkspaceProps): React.JSX.Element {
  const editor = useMatterEditor(teamName, matter, hook.updateMatter);
  const [selectedStage, setSelectedStage] = useState<MatterStageId | null>(null);

  const currentStage = editor.matter.currentStage ?? 'discovery';
  const activeStage: MatterStageId =
    selectedStage ?? (STAGE_ORDER.includes(currentStage) ? currentStage : 'discovery');

  const selectStage = useCallback(
    (stage: MatterStageId) => {
      editor.flushNow();
      setSelectedStage(stage);
    },
    [editor]
  );

  const proposalTargetsThisMatter =
    hook.proposal !== null &&
    (hook.proposal.matterId === undefined || hook.proposal.matterId === matter.id);

  const meta = [editor.matter.matterNumber, editor.matter.caseNumber, editor.matter.department]
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  return (
    <>
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
          <button
            type="button"
            onClick={onBack}
            className="hover:text-[oklch(0.52_0.17_262)]"
            style={{
              font: 'inherit',
              fontSize: 11.5,
              fontWeight: 600,
              color: MUTED,
              cursor: 'pointer',
              marginBottom: 7,
              display: 'inline-block',
              border: 'none',
              background: 'transparent',
              padding: 0,
            }}
          >
            ← All matters
          </button>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: '-0.015em' }}>
            {editor.matter.caption ?? 'New matter'}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 9 }}>
            <ToneSelect
              value={editor.matter.status ?? 'Active'}
              onChange={(value) => editor.setScalar('status', value)}
              options={MATTER_STATUSES}
            />
            <span style={{ fontSize: 12.5, color: MUTED }}>{meta || '—'}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, background: BORDER, padding: 3, borderRadius: 10 }}>
          {(
            [
              ['matter', 'Matter'],
              ['history', 'Procedural History'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => onTab(id)}
              style={{
                font: 'inherit',
                fontSize: 13,
                fontWeight: 600,
                padding: '6px 15px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                background: tab === id ? '#fff' : 'transparent',
                color: tab === id ? INK : BODY,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {teamName && (
        <MatterActionsBar
          acting={hook.refreshActing}
          message={hook.refreshMessage}
          error={hook.refreshError}
          onRefresh={() => hook.requestRefresh(matter.id)}
        />
      )}
      {teamName && (
        <LinkEvidencePanel
          status={hook.linkStatus}
          acting={hook.linkActing}
          message={hook.linkMessage}
          error={hook.linkError}
          onCheck={hook.checkLinkStatus}
          onInitialize={hook.initializeLink}
          onRefresh={hook.requestLinkRefresh}
          onProposal={() => hook.requestLinkProposal(matter.id)}
        />
      )}
      {proposalTargetsThisMatter && hook.proposal && (
        <ProposalReviewPanel
          proposal={hook.proposal}
          matter={matter}
          acting={hook.acting}
          onApprove={hook.applyProposal}
          onReject={hook.rejectProposal}
        />
      )}
      {hook.error && (
        <div style={{ color: RED, fontSize: 12.5, marginBottom: 12 }}>{hook.error}</div>
      )}

      {tab === 'history' ? (
        <ProceduralHistoryView editor={editor} />
      ) : (
        <div
          className="matter-dashboard-columns"
          style={{
            display: 'grid',
            gridTemplateColumns: '320px 1fr',
            gap: 20,
            alignItems: 'start',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <MatterCorePanel editor={editor} showRequiredMarkers={showRequiredMarkers} />
            <NextDeadlineCard editor={editor} />
            <PartiesPanel editor={editor} />
          </div>
          <Card padding="20px 22px">
            <div
              className="matter-dashboard-stagegrid"
              style={{
                display: 'grid',
                gridTemplateColumns: '236px 1fr',
                gap: 22,
                alignItems: 'start',
              }}
            >
              <StageRail
                matter={editor.matter}
                activeStage={activeStage}
                onSelectStage={selectStage}
              />
              <div style={{ borderLeft: `1px solid ${BORDER}`, paddingLeft: 22, minHeight: 520 }}>
                {activeStage === 'pleading' && <PleadingPane editor={editor} />}
                {activeStage === 'discovery' && <DiscoveryPane editor={editor} />}
                {activeStage === 'trial' && <TrialPane editor={editor} />}
                {activeStage === 'settlement' && <SettlementPane editor={editor} />}
                {activeStage === 'post' && <PostJudgmentPane editor={editor} />}
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

interface MatterActionsBarProps {
  readonly acting: boolean;
  readonly message: string | null;
  readonly error: string | null;
  readonly onRefresh: () => Promise<void>;
}

/**
 * Always-available dashboard actions, above the state-gated Link controls. The
 * refresh button asks the team lead to follow the matter-dashboard skill;
 * agent-driven changes still only land when the user approves the proposal.
 */
function MatterActionsBar({
  acting,
  message,
  error,
  onRefresh,
}: MatterActionsBarProps): React.JSX.Element {
  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: '12px 16px',
        marginBottom: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 240, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 750 }}>Matter dashboard</div>
        <div style={{ color: error ? RED : MUTED, fontSize: 11.5, marginTop: 4 }}>
          {error ??
            message ??
            'Your edits save directly. The refresh button asks the team lead to scan the case folder and propose an update for review.'}
        </div>
      </div>
      <button
        type="button"
        disabled={acting}
        onClick={() => void onRefresh()}
        style={{
          border: `1px solid ${ACCENT}`,
          borderRadius: 8,
          background: ACCENT,
          color: '#fff',
          cursor: acting ? 'default' : 'pointer',
          font: 'inherit',
          fontSize: 12,
          fontWeight: 650,
          padding: '5px 10px',
        }}
      >
        {acting ? 'Asking lead…' : 'Refresh dashboard'}
      </button>
    </div>
  );
}
