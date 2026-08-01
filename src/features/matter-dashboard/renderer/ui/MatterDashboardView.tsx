import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { useMatter } from '../hooks/useMatter';

import type {
  MatterChanges,
  MatterDiscoveryDto,
  MatterDto,
  MatterPendingMotionDto,
  MatterPleadingDto,
  MatterPostJudgmentDto,
  MatterProposalDto,
  MatterTrialDto,
} from '../../contracts';

/**
 * Matter Dashboard — React port of the "Matter Dashboard v2" Claude Design
 * component (claude.ai/design project 2184a839, `Matter Dashboard v2.dc.html`).
 *
 * The design ships with a demo litigation matter (Anderson v. Meridian
 * Logistics) baked in; the `DEMO_*` fixtures below are that data. When a
 * `teamName` is provided, live values from the team's `matter.json` overlay
 * the fixtures section by section (`useMatter`), and a pending update
 * proposal from the team lead renders as a review panel the user can approve
 * or reject. Field edits and stage selection are kept in local component
 * state, mirroring the original DCLogic behavior; local edits reset when an
 * approved update lands.
 */

const ACCENT = 'oklch(0.52 0.17 262)';
const ACCENT_DARK = 'oklch(0.42 0.17 262)';
const RED = 'oklch(0.5 0.17 27)';
const INK = '#12161f';
const MUTED = '#8a92a0';
const FAINT = '#b6bcc7';
const BODY = '#5b6472';
const BORDER = '#e4e7ec';
const HAIRLINE = '#f0f1f4';

const DANGER_VALUES = new Set([
  'Disputed',
  'Impasse',
  'Unresolved',
  'Vacated',
  'Excluded',
  'Withdrawn',
  'Conflict',
  'Objection Pending',
  'Needs Follow-up',
]);
const LIVE_VALUES = new Set([
  'Active',
  'Served',
  'Producing',
  'Issued',
  'In Review',
  'Marked',
  'Entered',
  'Tentative',
  'In Progress',
  'Investigating Assets',
]);

function toneFor(value: string): { bg: string; fg: string } {
  if (DANGER_VALUES.has(value)) return { bg: 'oklch(0.96 0.025 27)', fg: RED };
  if (LIVE_VALUES.has(value)) return { bg: 'oklch(0.95 0.03 262)', fg: ACCENT_DARK };
  return { bg: '#fff', fg: INK };
}

type Vals = Record<string, string>;
type SetVal = (key: string, value: string) => void;

interface ToneSelectProps {
  valueKey: string;
  defaultValue: string;
  options: readonly string[];
  vals: Vals;
  setVal: SetVal;
  /** Skip status-tone coloring and render on a plain white background. */
  plain?: boolean;
  pill?: boolean;
  small?: boolean;
}

const ToneSelect = ({
  valueKey,
  defaultValue,
  options,
  vals,
  setVal,
  plain,
  pill,
  small,
}: ToneSelectProps): React.JSX.Element => {
  const value = vals[valueKey] ?? defaultValue;
  const tone = plain ? { bg: '#fff', fg: INK } : toneFor(value);
  // Live data may carry values outside the design's canonical option lists.
  const effectiveOptions = options.includes(value) ? options : [value, ...options];
  return (
    <select
      value={value}
      onChange={(e) => setVal(valueKey, e.target.value)}
      className="cursor-pointer focus:outline-[oklch(0.75_0.1_262)]"
      style={{
        font: 'inherit',
        fontSize: small ? 12 : 12.5,
        fontWeight: 600,
        padding: small ? '2px 6px' : '3px 9px',
        borderRadius: pill ? 99 : small ? 7 : 8,
        border: '1px solid #d6dae2',
        background: tone.bg,
        color: tone.fg,
        maxWidth: '100%',
      }}
    >
      {effectiveOptions.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
};

interface InlineInputProps {
  valueKey: string;
  defaultValue: string;
  vals: Vals;
  setVal: SetVal;
  bold?: boolean;
  color?: string;
  negativeMargin?: boolean;
}

const InlineInput = ({
  valueKey,
  defaultValue,
  vals,
  setVal,
  bold,
  color,
  negativeMargin,
}: InlineInputProps): React.JSX.Element => {
  const value = vals[valueKey] ?? defaultValue;
  return (
    <input
      value={value}
      onChange={(e) => setVal(valueKey, e.target.value)}
      className="border border-transparent bg-transparent hover:border-[#d6dae2] hover:bg-white focus:border-[oklch(0.7_0.1_262)] focus:bg-white focus:outline-none"
      style={{
        font: 'inherit',
        fontSize: 12.5,
        fontWeight: bold ? 600 : 500,
        padding: bold ? '2px 7px' : '1px 6px',
        marginLeft: negativeMargin ? -7 : undefined,
        borderRadius: 7,
        color: color ?? (value === '—' ? FAINT : INK),
        width: '100%',
        boxSizing: 'border-box',
      }}
    />
  );
};

const FieldLabel = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 3 }}>{children}</div>
);

const PanelTitle = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div
    style={{
      fontSize: 12,
      fontWeight: 700,
      color: MUTED,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      marginBottom: 10,
    }}
  >
    {children}
  </div>
);

const STAGE_ORDER = ['pleading', 'discovery', 'trial', 'post'] as const;
type StageId = (typeof STAGE_ORDER)[number];

const DEMO_CAPTION = 'Anderson v. Meridian Logistics, Inc.';
const DEMO_MATTER_NUMBER = 'AM-2025-0148';
const DEMO_NEXT_DEADLINE = 'Aug 14, 2026 — Opposition to Motion to Compel';

const DEMO_STAGE_META: readonly { id: StageId; label: string; dates: string; summary: string }[] = [
  {
    id: 'pleading',
    label: 'Pleading',
    dates: 'Mar – Jun 2025',
    summary: 'FAC operative · answer filed',
  },
  {
    id: 'discovery',
    label: 'Discovery',
    dates: 'Jul 2025 – present',
    summary: '5 requests · 1 motion pending',
  },
  { id: 'trial', label: 'Trial', dates: 'Set for Feb 8, 2027', summary: 'Jury · est. 7 days' },
  { id: 'post', label: 'Post-Judgment', dates: '—', summary: 'Not started' },
];

const DEMO_CORE_FIELDS: readonly { l: string; v: string; req?: boolean }[] = [
  { l: 'Client', v: 'Daniel Anderson' },
  { l: 'Client ID', v: 'c9d2f8a1-…-41ab' },
  { l: 'Matter No.', v: 'AM-2025-0148' },
  { l: 'Case No.', v: '24STCV18832' },
  { l: 'Court', v: 'Los Angeles Superior Court' },
  { l: 'Department', v: 'Dept. 32' },
  { l: 'Court location', v: 'Stanley Mosk Courthouse, Los Angeles' },
  { l: 'Judge', v: 'Hon. Maria Delgado' },
  { l: 'Court contact', v: '(213) 555-0132 · dept32@lacourt.org' },
  { l: 'Clerk', v: 'R. Okafor' },
  { l: 'Dept. rules', v: 'Standing order re: discovery conferences' },
  { l: 'Jurisdiction', v: 'California' },
  { l: 'Opened', v: 'Mar 12, 2025' },
  { l: 'Closed', v: '—' },
  { l: 'Docs workspace', v: 'Anderson v. Meridian / Case Files', req: true },
];

const DEMO_SYS_FIELDS: readonly { l: string; v: string }[] = [
  { l: 'Matter ID', v: '3f8a1c2e-7b4d-4e90-a1f3-6c2d5e8b9b7d' },
  { l: 'Control issue', v: 'CTL-0148' },
  { l: 'Created', v: '2025-03-12 09:14' },
  { l: 'Updated', v: '2026-07-29 16:42' },
];

const EMPTY_VALUE = '—';
const EMPTY_CORE_FIELDS = DEMO_CORE_FIELDS.map((field) => ({ ...field, v: EMPTY_VALUE }));
const EMPTY_SYS_FIELDS = DEMO_SYS_FIELDS.map((field) => ({ ...field, v: EMPTY_VALUE }));

const REQ_TYPES = [
  'RFP',
  'RFA',
  'Special Interrogatories',
  'Form Interrogatories',
  'Deposition Notice',
  'Subpoena',
  'Inspection Demand',
  'Expert Discovery',
  'Other',
];
const REQ_STATUSES = [
  'Draft',
  'Issued',
  'Served',
  'Responded',
  'Producing',
  'Complete',
  'Disputed',
  'Withdrawn',
];

interface RequestRow {
  k: string;
  type: string;
  set: string;
  parties: string;
  served: string;
  due: string;
  status: string;
}

const DEMO_REQUESTS: readonly RequestRow[] = [
  {
    k: 'r1',
    type: 'RFP',
    set: 'Set One — contracts & ESI',
    parties: 'Anderson → Meridian',
    served: 'Sep 2, 2025',
    due: 'Oct 6, 2025',
    status: 'Responded',
  },
  {
    k: 'r2',
    type: 'Form Interrogatories',
    set: 'Set One',
    parties: 'Meridian → Anderson',
    served: 'Sep 15, 2025',
    due: 'Oct 17, 2025',
    status: 'Responded',
  },
  {
    k: 'r3',
    type: 'Special Interrogatories',
    set: 'Set Two — damages',
    parties: 'Anderson → Meridian',
    served: 'Mar 9, 2026',
    due: 'Apr 10, 2026',
    status: 'Disputed',
  },
  {
    k: 'r4',
    type: 'Deposition Notice',
    set: 'Meridian PMQ',
    parties: 'Anderson → Meridian',
    served: 'Apr 21, 2026',
    due: 'May 19, 2026',
    status: 'Complete',
  },
  {
    k: 'r5',
    type: 'RFA',
    set: 'Set One',
    parties: 'Meridian → Anderson',
    served: 'May 28, 2026',
    due: 'Jun 29, 2026',
    status: 'Responded',
  },
];

interface ProductionRow {
  k: string;
  type: string;
  bates: string;
  date: string;
}

const DEMO_PRODUCTIONS: readonly ProductionRow[] = [
  { k: 'p1', type: 'Initial', bates: 'MER000001–004212', date: 'Oct 14, 2025' },
  { k: 'p2', type: 'Supplemental', bates: 'MER004213–005871', date: 'Jan 22, 2026' },
];
const PRODUCTION_TYPES = ['Initial', 'Supplemental', 'Corrected', 'Rolling', 'Privilege Log'];

const DEPO_OPTS = ['Not Started', 'In Review', 'Complete', 'Needs Follow-up'];

interface DepositionRow {
  k: string;
  name: string;
  taken: string;
  review: string;
  note: string;
  noteColor: string;
}

const DEMO_DEPOSITIONS: readonly DepositionRow[] = [
  {
    k: 'd1',
    name: 'D. Anderson',
    taken: 'taken Apr 7, 2026',
    review: 'In Review',
    note: '',
    noteColor: MUTED,
  },
  {
    k: 'd2',
    name: 'Meridian PMQ',
    taken: 'taken May 19, 2026',
    review: 'Complete',
    note: 'errata due Aug 2, 2026',
    noteColor: RED,
  },
];

const DEMO_MOTION_TEXT_FIELDS: readonly { k: string; l: string; v: string; vc?: string }[] = [
  { k: 'mo_type', l: 'Motion type', v: 'Motion to Compel Further Responses' },
  { k: 'mo_req', l: 'Related request', v: 'Special Interrogatories — Set Two' },
  { k: 'mo_resv', l: 'Reservation', v: 'Jun 20, 2026' },
  { k: 'mo_filed', l: 'Filed', v: 'Jul 10, 2026' },
  { k: 'mo_opp', l: 'Opposition due', v: 'Aug 14, 2026', vc: RED },
  { k: 'mo_reply', l: 'Reply due', v: 'Aug 27, 2026' },
  { k: 'mo_hear', l: 'Hearing', v: 'Sep 3, 2026 · Dept. 32' },
];
const MOTION_OUTCOMES = [
  'Pending',
  'Granted',
  'Granted in Part',
  'Denied',
  'Off Calendar',
  'Withdrawn',
];

const MOTION_FIELD_KEYS: Record<string, keyof MatterPendingMotionDto> = {
  mo_type: 'motionType',
  mo_req: 'relatedRequest',
  mo_resv: 'reservation',
  mo_filed: 'filed',
  mo_opp: 'oppositionDue',
  mo_reply: 'replyDue',
  mo_hear: 'hearing',
};

const PRETRIAL_STATUSES = ['Not Started', 'Prepared', 'Filed', 'Served', 'Complete'];

interface PretrialRow {
  k: string;
  t: string;
  d: string;
  src: string;
  s: string;
}

const DEMO_PRETRIAL: readonly PretrialRow[] = [
  {
    k: 'pt1',
    t: 'Witness & exhibit lists',
    d: 'Jan 15, 2027',
    src: 'LASC Rule 3.25',
    s: 'Not Started',
  },
  {
    k: 'pt2',
    t: 'Final Status Conference',
    d: 'Jan 22, 2027',
    src: 'Court order',
    s: 'Not Started',
  },
  {
    k: 'pt3',
    t: 'Jury instructions & verdict forms',
    d: 'Jan 29, 2027',
    src: 'CCP §607a',
    s: 'Not Started',
  },
  { k: 'pt4', t: 'Trial brief', d: 'Feb 1, 2027', src: 'Standing order', s: 'Not Started' },
];

const WITNESS_ROLES = ['Fact', 'Expert', 'PMQ', 'Custodian', 'Impeachment'];
const WITNESS_AVAIL = ['Confirmed', 'Tentative', 'Conflict', 'Unknown'];

interface WitnessRow {
  k: string;
  name: string;
  role: string;
  party: string;
  avail: string;
}

const DEMO_WITNESSES: readonly WitnessRow[] = [
  { k: 'w1', name: 'D. Anderson', role: 'Fact', party: 'Plaintiff', avail: 'Confirmed' },
  { k: 'w2', name: 'K. Ramos', role: 'PMQ', party: 'Defendant', avail: 'Tentative' },
  { k: 'w3', name: 'Dr. E. Chou', role: 'Expert', party: 'Plaintiff', avail: 'Confirmed' },
];

const EXHIBIT_ADMISSIONS = ['Proposed', 'Marked', 'Admitted', 'Excluded', 'Withdrawn'];

interface ExhibitRow {
  k: string;
  num: string;
  title: string;
  adm: string;
}

const DEMO_EXHIBITS: readonly ExhibitRow[] = [
  { k: 'x1', num: '101', title: 'Master Services Agreement', adm: 'Proposed' },
  { k: 'x2', num: '102', title: 'Delivery logs 2024–2025', adm: 'Proposed' },
  { k: 'x3', num: '201', title: 'Meridian operations manual', adm: 'Marked' },
];

const SECTION_LABELS: Record<keyof MatterChanges, string> = {
  caption: 'Caption',
  status: 'Status',
  matterNumber: 'Matter No.',
  currentStage: 'Current stage',
  coreFields: 'Matter fields',
  systemFields: 'System fields',
  stages: 'Stage summaries',
  nextDeadline: 'Next deadline',
  pleading: 'Pleading',
  discovery: 'Discovery',
  trial: 'Trial',
  postJudgment: 'Post-Judgment',
};

const MATTER_DASHBOARD_RESPONSIVE_CSS = `
  .matter-dashboard-main-grid {
    grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  }

  .matter-dashboard-stage-grid {
    grid-template-columns: minmax(200px, 240px) minmax(0, 1fr);
  }

  .matter-dashboard-stage-detail {
    border-left: 1px solid ${BORDER};
    padding-left: 24px;
    min-height: 420px;
  }

  .matter-dashboard-trial-summary {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .matter-dashboard-pretrial-row {
    grid-template-columns: 1.8fr 0.9fr 1.1fr 1fr;
  }

  .matter-dashboard-trial-secondary-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .matter-dashboard-discovery-secondary-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  @container (max-width: 980px) {
    .matter-dashboard-main-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @container (max-width: 700px) {
    .matter-dashboard-stage-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .matter-dashboard-stage-nav {
      display: grid !important;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .matter-dashboard-stage-detail {
      border-left: 0;
      border-top: 1px solid ${BORDER};
      padding-left: 0;
      padding-top: 20px;
      min-height: 0;
    }
  }

  @container (max-width: 620px) {
    .matter-dashboard-trial-summary,
    .matter-dashboard-pretrial-row,
    .matter-dashboard-trial-secondary-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .matter-dashboard-discovery-secondary-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .matter-dashboard-pretrial-row {
      row-gap: 6px !important;
    }
  }

  @container (max-width: 420px) {
    .matter-dashboard-stage-nav,
    .matter-dashboard-trial-summary,
    .matter-dashboard-pretrial-row,
    .matter-dashboard-trial-secondary-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
`;

interface MatterDashboardViewProps {
  /** Which case stage is currently in progress. Defaults to discovery. */
  currentStage?: StageId;
  /** Show required-field markers next to fields the intake contract requires. */
  showRequiredMarkers?: boolean;
  /** Team whose live matter data overlays the demo fixture. */
  teamName?: string;
}

export const MatterDashboardView = memo(function MatterDashboardView({
  currentStage = 'discovery',
  showRequiredMarkers = true,
  teamName,
}: MatterDashboardViewProps): React.JSX.Element {
  const { matter, proposal, acting, applyProposal, rejectProposal } = useMatter(teamName);
  const [selectedStage, setSelectedStage] = useState<StageId | null>(null);
  const [vals, setVals] = useState<Vals>({});
  const setVal = useCallback<SetVal>((key, value) => {
    setVals((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Local inline edits are display-only; an approved update supersedes them.
  const matterUpdatedAt = matter?.updatedAt;
  useEffect(() => {
    setVals({});
  }, [matterUpdatedAt]);

  const effectiveCurrentStage = matter?.currentStage ?? currentStage;
  const currentIndex = STAGE_ORDER.includes(effectiveCurrentStage)
    ? STAGE_ORDER.indexOf(effectiveCurrentStage)
    : STAGE_ORDER.indexOf('discovery');
  const activeStage: StageId = selectedStage ?? STAGE_ORDER[currentIndex];
  const reqOn = showRequiredMarkers;
  const requiredMark = (
    <span title="Required field" style={{ color: ACCENT, fontWeight: 700 }}>
      {' '}
      *
    </span>
  );

  const live = matter !== null;
  const caption = matter?.caption ?? (live ? 'New matter' : DEMO_CAPTION);
  const matterNumber = matter?.matterNumber ?? (live ? EMPTY_VALUE : DEMO_MATTER_NUMBER);
  const statusDefault = matter?.status ?? (live ? 'Planned' : 'Active');
  const nextDeadlineText = matter?.nextDeadline
    ? `${matter.nextDeadline.date} — ${matter.nextDeadline.label}`
    : live
      ? null
      : DEMO_NEXT_DEADLINE;

  const coreFields = useMemo(
    () =>
      matter?.coreFields?.length
        ? matter.coreFields.map((field) => ({ l: field.label, v: field.value }))
        : matter
          ? EMPTY_CORE_FIELDS
          : DEMO_CORE_FIELDS,
    [matter]
  );
  const sysFields = useMemo(
    () =>
      matter?.systemFields?.length
        ? matter.systemFields.map((field) => ({ l: field.label, v: field.value }))
        : matter
          ? EMPTY_SYS_FIELDS
          : DEMO_SYS_FIELDS,
    [matter]
  );
  const stages = useMemo(
    () =>
      DEMO_STAGE_META.map((stage) => {
        const base = matter ? { ...stage, dates: EMPTY_VALUE, summary: EMPTY_VALUE } : stage;
        const liveStage = matter?.stages?.find((entry) => entry.id === stage.id);
        return liveStage
          ? {
              ...base,
              label: liveStage.label ?? base.label,
              dates: liveStage.dates ?? base.dates,
              summary: liveStage.summary ?? base.summary,
            }
          : base;
      }),
    [matter]
  );

  const selectProps = { vals, setVal };

  return (
    <div
      style={{
        background: '#eef0f3',
        borderRadius: 14,
        color: INK,
        fontSize: 14,
        containerType: 'inline-size',
      }}
    >
      <style>{MATTER_DASHBOARD_RESPONSIVE_CSS}</style>
      <div
        style={{
          maxWidth: 1440,
          margin: '0 auto',
          padding: 20,
        }}
      >
        {proposal && (
          <ProposalReviewPanel
            proposal={proposal}
            matter={matter}
            acting={acting}
            onApprove={applyProposal}
            onReject={rejectProposal}
          />
        )}
        <div
          className="matter-dashboard-main-grid"
          style={{
            display: 'grid',
            gap: 20,
            alignItems: 'start',
          }}
        >
          {/* Left column: matter card + next deadline */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div
              style={{
                background: '#fff',
                border: `1px solid ${BORDER}`,
                borderRadius: 14,
                padding: '20px 22px',
                boxShadow: '0 1px 2px rgba(16,24,40,0.04)',
              }}
            >
              <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>
                {caption}
                {reqOn && requiredMark}
              </h1>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0 16px' }}
              >
                <ToneSelect
                  valueKey="core_status"
                  defaultValue={statusDefault}
                  options={['Planned', 'Active', 'Completed', 'Archived']}
                  {...selectProps}
                />
                {reqOn && requiredMark}
                <span style={{ fontSize: 12.5, color: MUTED }}>{matterNumber}</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  margin: '-6px 0 14px',
                  fontSize: 11.5,
                  color: MUTED,
                  flexWrap: 'wrap',
                }}
              >
                {matter ? (
                  <span>
                    {matter.updatedAt
                      ? `Updated ${matter.updatedAt}${
                          matter.updatedBy ? ` by @${matter.updatedBy}` : ''
                        }${matter.approvedBy ? ` · approved by ${matter.approvedBy}` : ''}`
                      : 'No matter updates yet'}
                  </span>
                ) : (
                  <span
                    style={{
                      border: '1px solid #d6dae2',
                      borderRadius: 99,
                      padding: '1px 9px',
                      fontWeight: 600,
                      background: '#f7f8fa',
                    }}
                  >
                    Demo data
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {coreFields.map((field) => (
                  <div
                    key={field.l}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '125px 1fr',
                      gap: 10,
                      alignItems: 'center',
                      fontSize: 12.5,
                    }}
                  >
                    <span style={{ color: MUTED }}>
                      {field.l}
                      {reqOn && 'req' in field && field.req === true && requiredMark}
                    </span>
                    <InlineInput
                      valueKey={`core_${field.l}`}
                      defaultValue={field.v}
                      negativeMargin
                      {...selectProps}
                    />
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${HAIRLINE}` }}>
                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: FAINT,
                    marginBottom: 8,
                  }}
                >
                  System
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {sysFields.map((field) => (
                    <div
                      key={field.l}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '125px 1fr',
                        gap: 10,
                        fontSize: 12,
                        color: MUTED,
                      }}
                    >
                      <span>{field.l}</span>
                      <span
                        style={{
                          fontFamily: 'ui-monospace, monospace',
                          fontSize: 11.5,
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {field.v}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {nextDeadlineText ? (
              <div
                style={{
                  background: 'oklch(0.96 0.025 27)',
                  border: '1px solid oklch(0.9 0.04 27)',
                  borderRadius: 14,
                  padding: '14px 18px',
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: RED,
                    marginBottom: 4,
                  }}
                >
                  Next deadline
                </div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{nextDeadlineText}</div>
              </div>
            ) : null}
          </div>

          {/* Right column: case stage */}
          <div
            style={{
              background: '#fff',
              border: `1px solid ${BORDER}`,
              borderRadius: 14,
              padding: '22px 24px',
              boxShadow: '0 1px 2px rgba(16,24,40,0.04)',
              minWidth: 0,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: MUTED,
                marginBottom: 14,
              }}
            >
              Case stage
            </div>
            <div
              className="matter-dashboard-stage-grid"
              style={{
                display: 'grid',
                gap: 24,
                alignItems: 'start',
              }}
            >
              <div
                className="matter-dashboard-stage-nav"
                style={{ display: 'flex', flexDirection: 'column' }}
              >
                {stages.map((stage, index) => {
                  const done = index < currentIndex;
                  const inProgress = index === currentIndex;
                  const active = activeStage === stage.id;
                  return (
                    <button
                      key={stage.id}
                      type="button"
                      onClick={() => setSelectedStage(stage.id)}
                      className="hover:bg-[#f4f5f8]"
                      style={{
                        display: 'flex',
                        gap: 12,
                        cursor: 'pointer',
                        padding: '10px 12px',
                        borderRadius: 10,
                        background: active ? 'oklch(0.97 0.012 262)' : 'transparent',
                        border: 'none',
                        textAlign: 'left',
                        font: 'inherit',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <span
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 99,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 11,
                            fontWeight: 700,
                            background: done ? INK : inProgress ? ACCENT : '#d6dae2',
                            color: done || inProgress ? '#fff' : BODY,
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
                            minHeight: 14,
                          }}
                        />
                      </div>
                      <div style={{ paddingBottom: 10 }}>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: done || inProgress ? INK : MUTED,
                          }}
                        >
                          {stage.label}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: inProgress ? ACCENT : MUTED,
                          }}
                        >
                          {done ? 'Completed' : inProgress ? 'In progress' : 'Upcoming'}
                        </div>
                        <div style={{ fontSize: 12, color: MUTED }}>{stage.dates}</div>
                        <div style={{ fontSize: 12, color: BODY, marginTop: 3 }}>
                          {stage.summary}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div
                className="matter-dashboard-stage-detail"
                style={{ containerType: 'inline-size' }}
              >
                {activeStage === 'pleading' && (
                  <PleadingPane data={matter?.pleading} live={live} {...selectProps} />
                )}
                {activeStage === 'discovery' && (
                  <DiscoveryPane data={matter?.discovery} live={live} {...selectProps} />
                )}
                {activeStage === 'trial' && (
                  <TrialPane data={matter?.trial} live={live} {...selectProps} />
                )}
                {activeStage === 'post' && (
                  <PostJudgmentPane data={matter?.postJudgment} {...selectProps} />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

interface ProposalReviewPanelProps {
  proposal: MatterProposalDto;
  matter: MatterDto | null;
  acting: boolean;
  onApprove: () => Promise<void>;
  onReject: (reason?: string) => Promise<void>;
}

function describeDiffValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => describeDiffValue(item)).join('; ');
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .join(' · ');
  }
  return String(value);
}

function buildSectionDiffRows(
  sectionKey: keyof MatterChanges,
  proposed: unknown,
  current: unknown
): { label: string; before: string; after: string }[] {
  if (Array.isArray(proposed)) {
    return [
      {
        label: `${SECTION_LABELS[sectionKey]} (replaces list)`,
        before: describeDiffValue(current),
        after: describeDiffValue(proposed),
      },
    ];
  }
  if (proposed !== null && typeof proposed === 'object') {
    const currentRecord =
      current !== null && typeof current === 'object' ? (current as Record<string, unknown>) : {};
    return Object.entries(proposed as Record<string, unknown>).map(([key, value]) => ({
      label: `${SECTION_LABELS[sectionKey]} · ${key}`,
      before: describeDiffValue(currentRecord[key]),
      after: describeDiffValue(value),
    }));
  }
  return [
    {
      label: SECTION_LABELS[sectionKey],
      before: describeDiffValue(current),
      after: describeDiffValue(proposed),
    },
  ];
}

const ProposalReviewPanel = ({
  proposal,
  matter,
  acting,
  onApprove,
  onReject,
}: ProposalReviewPanelProps): React.JSX.Element => {
  const [reason, setReason] = useState('');

  const diffRows = useMemo(() => {
    const currentRecord = (matter ?? {}) as Record<string, unknown>;
    return (Object.keys(proposal.changes) as (keyof MatterChanges)[]).flatMap((sectionKey) =>
      buildSectionDiffRows(sectionKey, proposal.changes[sectionKey], currentRecord[sectionKey])
    );
  }, [proposal, matter]);

  return (
    <div
      style={{
        background: 'oklch(0.97 0.02 262)',
        border: '1px solid oklch(0.88 0.05 262)',
        borderRadius: 14,
        padding: '16px 20px',
        marginBottom: 20,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: ACCENT_DARK,
          }}
        >
          Proposed dashboard update — awaiting your review
        </span>
        <span style={{ fontSize: 12, color: MUTED }}>
          by @{proposal.proposedBy} · {proposal.proposedAt}
        </span>
      </div>
      <ul style={{ margin: '0 0 10px', paddingLeft: 18 }}>
        {proposal.summary.map((line, index) => (
          <li key={index} style={{ fontSize: 13, lineHeight: 1.5 }}>
            {line}
          </li>
        ))}
      </ul>
      {proposal.taskRefs && proposal.taskRefs.length > 0 && (
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 10 }}>
          From tasks: {proposal.taskRefs.map((taskId) => `#${taskId.slice(0, 8)}`).join(', ')}
        </div>
      )}
      <div
        style={{
          background: '#fff',
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          padding: '10px 14px',
          marginBottom: 12,
          maxHeight: 260,
          overflowY: 'auto',
        }}
      >
        {diffRows.map((row, index) => (
          <div
            key={index}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(140px, 220px) 1fr',
              gap: 10,
              padding: '4px 0',
              borderBottom: index < diffRows.length - 1 ? `1px solid ${HAIRLINE}` : undefined,
              fontSize: 12.5,
            }}
          >
            <span style={{ color: MUTED }}>{row.label}</span>
            <span style={{ overflowWrap: 'anywhere' }}>
              {row.before !== row.after && (
                <span style={{ color: FAINT, textDecoration: 'line-through', marginRight: 8 }}>
                  {row.before}
                </span>
              )}
              <span style={{ fontWeight: 600 }}>{row.after}</span>
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={acting}
          onClick={() => void onApprove()}
          style={{
            font: 'inherit',
            fontSize: 12.5,
            fontWeight: 700,
            color: '#fff',
            background: acting ? '#a9b3c9' : ACCENT,
            border: 'none',
            borderRadius: 8,
            padding: '6px 14px',
            cursor: acting ? 'default' : 'pointer',
          }}
        >
          Approve &amp; update
        </button>
        <button
          type="button"
          disabled={acting}
          onClick={() => void onReject(reason.trim() || undefined)}
          style={{
            font: 'inherit',
            fontSize: 12.5,
            fontWeight: 700,
            color: RED,
            background: '#fff',
            border: '1px solid oklch(0.85 0.06 27)',
            borderRadius: 8,
            padding: '6px 14px',
            cursor: acting ? 'default' : 'pointer',
          }}
        >
          Reject
        </button>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Rejection reason (sent to the lead)"
          style={{
            font: 'inherit',
            fontSize: 12.5,
            padding: '5px 10px',
            borderRadius: 8,
            border: '1px solid #d6dae2',
            flex: 1,
            minWidth: 220,
          }}
        />
      </div>
    </div>
  );
};

interface PaneProps {
  vals: Vals;
  setVal: SetVal;
  /** A matter file exists: absent values render empty instead of demo data. */
  live?: boolean;
}

const PleadingPane = ({
  data,
  live,
  vals,
  setVal,
}: PaneProps & { data?: MatterPleadingDto }): React.JSX.Element => (
  <div>
    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
      Pleading{' '}
      <span style={{ fontWeight: 500, color: MUTED, fontSize: 13 }}>
        · {data?.statusNote ?? (live ? 'not started' : 'completed Jun 2025')}
      </span>
    </div>
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '14px 24px',
        marginBottom: 16,
      }}
    >
      <div>
        <FieldLabel>Operative pleading</FieldLabel>
        <span
          className="hover:underline"
          style={{ fontSize: 13.5, fontWeight: 500, color: ACCENT }}
        >
          {data?.operativePleading ?? (live ? EMPTY_VALUE : 'First Amended Complaint')}
        </span>
      </div>
      <div>
        <FieldLabel>Pleading type</FieldLabel>
        <ToneSelect
          valueKey="plead_type"
          defaultValue={data?.pleadingType ?? 'Complaint'}
          options={['Complaint', 'Answer', 'Cross-Complaint', 'Petition', 'Response', 'Other']}
          plain
          vals={vals}
          setVal={setVal}
        />
      </div>
      <div>
        <FieldLabel>Amendment deadline</FieldLabel>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>
          {data?.amendmentDeadline ?? (live ? EMPTY_VALUE : 'Jun 30, 2025 — passed')}
        </div>
      </div>
    </div>
    <FieldLabel>Causes of action / affirmative defenses</FieldLabel>
    <div style={{ fontSize: 13.5, lineHeight: 1.55, maxWidth: 760 }}>
      {data?.causesOfAction ??
        (live
          ? EMPTY_VALUE
          : 'Breach of contract and negligence against Meridian Logistics. Answer filed Jun 9, 2025 asserting 14 affirmative defenses, including statute of limitations and comparative fault.')}
    </div>
  </div>
);

const DiscoveryPane = ({
  data,
  live,
  vals,
  setVal,
}: PaneProps & { data?: MatterDiscoveryDto }): React.JSX.Element => {
  const selectProps = { vals, setVal };
  const requests: readonly RequestRow[] = data?.requests?.length
    ? data.requests.map((request, index) => ({
        k: `r${index + 1}`,
        type: request.type,
        set: request.set ?? '—',
        parties: request.parties ?? '—',
        served: request.served ?? '—',
        due: request.due ?? '—',
        status: request.status ?? 'Draft',
      }))
    : live
      ? []
      : DEMO_REQUESTS;
  const productions: readonly ProductionRow[] = data?.productions?.length
    ? data.productions.map((production, index) => ({
        k: `p${index + 1}`,
        type: production.type,
        bates: production.bates ?? '—',
        date: production.date ?? '—',
      }))
    : live
      ? []
      : DEMO_PRODUCTIONS;
  const depositions: readonly DepositionRow[] = data?.depositions?.length
    ? data.depositions.map((deposition, index) => ({
        k: `d${index + 1}`,
        name: deposition.name,
        taken: deposition.taken ?? '—',
        review: deposition.review ?? 'Not Started',
        note: deposition.note ?? '',
        noteColor: RED,
      }))
    : live
      ? []
      : DEMO_DEPOSITIONS;
  const motion = data?.pendingMotion;
  const motionBaseFields = live
    ? DEMO_MOTION_TEXT_FIELDS.map((field) => ({ ...field, v: EMPTY_VALUE, vc: undefined }))
    : DEMO_MOTION_TEXT_FIELDS;
  const motionFields = motionBaseFields.map((field) => {
    const liveValue = motion?.[MOTION_FIELD_KEYS[field.k]];
    return liveValue !== undefined ? { ...field, v: liveValue } : field;
  });
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
        Discovery{' '}
        <span style={{ fontWeight: 500, color: ACCENT, fontSize: 13 }}>
          · {data?.statusNote ?? (live ? 'no activity recorded yet' : 'in progress')}
        </span>
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: MUTED,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 8,
        }}
      >
        Requests
      </div>
      <div
        style={{
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          overflowX: 'auto',
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.5fr 1.5fr 1.4fr 0.9fr 0.9fr 1.2fr',
            minWidth: 640,
            gap: 10,
            padding: '9px 14px',
            background: '#f7f8fa',
            borderBottom: `1px solid ${BORDER}`,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: MUTED,
          }}
        >
          <span>Type</span>
          <span>Set / Scope</span>
          <span>Parties</span>
          <span>Served</span>
          <span>Resp. due</span>
          <span>Status</span>
        </div>
        {requests.length === 0 && (
          <div style={{ padding: '10px 14px', fontSize: 12.5, color: MUTED }}>
            No requests recorded yet.
          </div>
        )}
        {requests.map((request) => (
          <div
            key={request.k}
            style={{
              display: 'grid',
              gridTemplateColumns: '1.5fr 1.5fr 1.4fr 0.9fr 0.9fr 1.2fr',
              minWidth: 640,
              gap: 10,
              alignItems: 'center',
              padding: '8px 14px',
              borderBottom: `1px solid ${HAIRLINE}`,
              fontSize: 12.5,
            }}
          >
            <span>
              <ToneSelect
                valueKey={`${request.k}t`}
                defaultValue={request.type}
                options={REQ_TYPES}
                plain
                small
                {...selectProps}
              />
            </span>
            <span style={{ fontWeight: 500 }}>{request.set}</span>
            <span style={{ color: BODY }}>{request.parties}</span>
            <span style={{ color: BODY }}>{request.served}</span>
            <span style={{ color: BODY }}>{request.due}</span>
            <span>
              <ToneSelect
                valueKey={`${request.k}s`}
                defaultValue={request.status}
                options={REQ_STATUSES}
                pill
                small
                {...selectProps}
              />
            </span>
          </div>
        ))}
      </div>
      <div
        className="matter-dashboard-discovery-secondary-grid"
        style={{ display: 'grid', gap: 14 }}
      >
        <div
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: 10,
            padding: '14px 16px',
            minWidth: 0,
          }}
        >
          <PanelTitle>
            Meet &amp; confer · {data?.meetConfer?.date ?? (live ? EMPTY_VALUE : 'Jun 3, 2026')}
          </PanelTitle>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 2 }}>Method</div>
              <ToneSelect
                valueKey="mc_method"
                defaultValue={data?.meetConfer?.method ?? 'Videoconference'}
                options={['Letter', 'Email', 'Telephone', 'Videoconference', 'In Person', 'Other']}
                plain
                small
                {...selectProps}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 2 }}>Outcome</div>
              <ToneSelect
                valueKey="mc_outcome"
                defaultValue={data?.meetConfer?.outcome ?? 'Unresolved'}
                options={[
                  'Resolved',
                  'Partially Resolved',
                  'Unresolved',
                  'Awaiting Response',
                  'Impasse',
                ]}
                small
                {...selectProps}
              />
            </div>
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: BODY }}>
            {data?.meetConfer?.notes ??
              (live ? (
                EMPTY_VALUE
              ) : (
                <>
                  Privilege and completeness objections re{' '}
                  <span className="hover:underline" style={{ color: ACCENT }}>
                    Special Interrogatories — Set Two
                  </span>
                  . Next step: motion to compel; deadline reserved.
                </>
              ))}
          </div>
        </div>
        <div
          style={{
            border: '1px solid oklch(0.9 0.04 27)',
            borderRadius: 10,
            background: 'oklch(0.985 0.008 27)',
            padding: '14px 16px',
            minWidth: 0,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: RED,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 10,
            }}
          >
            Pending motion
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {motionFields.map((field) => (
              <div
                key={field.k}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '110px minmax(0, 1fr)',
                  gap: 8,
                  alignItems: 'center',
                  fontSize: 12.5,
                }}
              >
                <span style={{ color: MUTED }}>{field.l}</span>
                <InlineInput
                  valueKey={field.k}
                  defaultValue={field.v}
                  color={field.vc}
                  bold
                  {...selectProps}
                />
              </div>
            ))}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '110px minmax(0, 1fr)',
                gap: 8,
                alignItems: 'center',
                fontSize: 12.5,
              }}
            >
              <span style={{ color: MUTED }}>Outcome</span>
              <span>
                <ToneSelect
                  valueKey="mo_outcome"
                  defaultValue={motion?.outcome ?? 'Pending'}
                  options={MOTION_OUTCOMES}
                  small
                  {...selectProps}
                />
              </span>
            </div>
          </div>
        </div>
        <div
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: 10,
            padding: '14px 16px',
            minWidth: 0,
          }}
        >
          <PanelTitle>Productions</PanelTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {productions.length === 0 && (
              <div style={{ fontSize: 12.5, color: MUTED }}>None recorded yet.</div>
            )}
            {productions.map((production) => (
              <div
                key={production.k}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 12.5,
                  flexWrap: 'wrap',
                }}
              >
                <ToneSelect
                  valueKey={production.k}
                  defaultValue={production.type}
                  options={PRODUCTION_TYPES}
                  plain
                  small
                  {...selectProps}
                />
                <span style={{ fontWeight: 500 }}>{production.bates}</span>
                <span style={{ color: MUTED }}>{production.date}</span>
              </div>
            ))}
          </div>
        </div>
        <div
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: 10,
            padding: '14px 16px',
            minWidth: 0,
          }}
        >
          <PanelTitle>Depositions</PanelTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {depositions.length === 0 && (
              <div style={{ fontSize: 12.5, color: MUTED }}>None recorded yet.</div>
            )}
            {depositions.map((deposition) => (
              <div
                key={deposition.k}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 12.5,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontWeight: 600 }}>{deposition.name}</span>
                <span style={{ color: MUTED }}>{deposition.taken}</span>
                <ToneSelect
                  valueKey={deposition.k}
                  defaultValue={deposition.review}
                  options={DEPO_OPTS}
                  small
                  {...selectProps}
                />
                <span style={{ color: deposition.noteColor }}>{deposition.note}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const TrialPane = ({
  data,
  live,
  vals,
  setVal,
}: PaneProps & { data?: MatterTrialDto }): React.JSX.Element => {
  const selectProps = { vals, setVal };
  const pretrial: readonly PretrialRow[] = data?.pretrialDeadlines?.length
    ? data.pretrialDeadlines.map((deadline, index) => ({
        k: `pt${index + 1}`,
        t: deadline.title,
        d: deadline.due ?? '—',
        src: deadline.source ?? '—',
        s: deadline.status ?? 'Not Started',
      }))
    : live
      ? []
      : DEMO_PRETRIAL;
  const witnesses: readonly WitnessRow[] = data?.witnesses?.length
    ? data.witnesses.map((witness, index) => ({
        k: `w${index + 1}`,
        name: witness.name,
        role: witness.role ?? 'Fact',
        party: witness.party ?? '—',
        avail: witness.availability ?? 'Unknown',
      }))
    : live
      ? []
      : DEMO_WITNESSES;
  const exhibits: readonly ExhibitRow[] = data?.exhibits?.length
    ? data.exhibits.map((exhibit, index) => ({
        k: `x${index + 1}`,
        num: exhibit.number,
        title: exhibit.title,
        adm: exhibit.admission ?? 'Proposed',
      }))
    : live
      ? []
      : DEMO_EXHIBITS;
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
        Trial{' '}
        <span style={{ fontWeight: 500, color: MUTED, fontSize: 13 }}>
          · {data?.statusNote ?? (live ? 'not scheduled' : 'upcoming')}
        </span>
      </div>
      <div
        className="matter-dashboard-trial-summary"
        style={{
          display: 'grid',
          gap: '14px 20px',
          marginBottom: 18,
        }}
      >
        <div>
          <FieldLabel>Trial date</FieldLabel>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>
            {data?.trialDate ?? (live ? EMPTY_VALUE : 'Feb 8, 2027')}
          </div>
        </div>
        <div>
          <FieldLabel>Trial type</FieldLabel>
          <ToneSelect
            valueKey="trial_type"
            defaultValue={data?.trialType ?? 'Jury Trial'}
            options={['Court Trial', 'Jury Trial']}
            plain
            {...selectProps}
          />
        </div>
        <div>
          <FieldLabel>Estimated duration</FieldLabel>
          <div style={{ fontSize: 13.5, fontWeight: 500 }}>
            {data?.estimatedDuration ?? (live ? EMPTY_VALUE : '7 days')}
          </div>
        </div>
        <div>
          <FieldLabel>Setting status</FieldLabel>
          <ToneSelect
            valueKey="trial_status"
            defaultValue={data?.settingStatus ?? 'Set'}
            options={['Set', 'Confirmed', 'Continued', 'Vacated', 'Completed']}
            {...selectProps}
          />
        </div>
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: MUTED,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 8,
        }}
      >
        Pretrial deadlines
      </div>
      <div
        style={{
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          overflow: 'hidden',
          marginBottom: 16,
        }}
      >
        {pretrial.length === 0 && (
          <div style={{ padding: '10px 14px', fontSize: 12.5, color: MUTED }}>
            No pretrial deadlines recorded yet.
          </div>
        )}
        {pretrial.map((deadline) => (
          <div
            key={deadline.k}
            className="matter-dashboard-pretrial-row"
            style={{
              display: 'grid',
              gap: 10,
              alignItems: 'center',
              padding: '8px 14px',
              borderBottom: `1px solid ${HAIRLINE}`,
              fontSize: 12.5,
            }}
          >
            <span style={{ fontWeight: 600 }}>{deadline.t}</span>
            <span style={{ color: BODY }}>{deadline.d}</span>
            <span style={{ color: MUTED }}>{deadline.src}</span>
            <span>
              <ToneSelect
                valueKey={deadline.k}
                defaultValue={deadline.s}
                options={PRETRIAL_STATUSES}
                plain
                small
                {...selectProps}
              />
            </span>
          </div>
        ))}
      </div>
      <div
        className="matter-dashboard-trial-secondary-grid"
        style={{ display: 'grid', gap: 14, marginBottom: 14 }}
      >
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: '14px 16px' }}>
          <PanelTitle>Witnesses</PanelTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {witnesses.length === 0 && (
              <div style={{ fontSize: 12.5, color: MUTED }}>None recorded yet.</div>
            )}
            {witnesses.map((witness) => (
              <div
                key={witness.k}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12.5,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontWeight: 600, minWidth: 110 }}>{witness.name}</span>
                <ToneSelect
                  valueKey={`${witness.k}r`}
                  defaultValue={witness.role}
                  options={WITNESS_ROLES}
                  plain
                  small
                  {...selectProps}
                />
                <span style={{ color: MUTED }}>{witness.party}</span>
                <ToneSelect
                  valueKey={`${witness.k}a`}
                  defaultValue={witness.avail}
                  options={WITNESS_AVAIL}
                  small
                  {...selectProps}
                />
              </div>
            ))}
          </div>
        </div>
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: '14px 16px' }}>
          <PanelTitle>Exhibits</PanelTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {exhibits.length === 0 && (
              <div style={{ fontSize: 12.5, color: MUTED }}>None recorded yet.</div>
            )}
            {exhibits.map((exhibit) => (
              <div
                key={exhibit.k}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12.5,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontWeight: 700, color: MUTED }}>{exhibit.num}</span>
                <span style={{ fontWeight: 600, flex: 1, minWidth: 130 }}>{exhibit.title}</span>
                <ToneSelect
                  valueKey={exhibit.k}
                  defaultValue={exhibit.adm}
                  options={EXHIBIT_ADMISSIONS}
                  small
                  {...selectProps}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: MUTED }}>
        {data?.continuancesNote ??
          'Continuances: none · Motions in limine, trial sessions, verdict and post-trial motions populate once trial begins.'}
      </div>
    </div>
  );
};

const PostJudgmentPane = ({
  data,
  vals,
  setVal,
}: PaneProps & { data?: MatterPostJudgmentDto }): React.JSX.Element => {
  const selectProps = { vals, setVal };
  const placeholder = <div style={{ fontSize: 13.5, fontWeight: 500, color: FAINT }}>—</div>;
  const textOrPlaceholder = (value?: string): React.JSX.Element =>
    value ? <div style={{ fontSize: 13.5, fontWeight: 500 }}>{value}</div> : placeholder;
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
        Post-Judgment Enforcement{' '}
        <span style={{ fontWeight: 500, color: MUTED, fontSize: 13 }}>
          · {data?.statusNote ?? 'not started'}
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '14px 20px',
          marginBottom: 16,
        }}
      >
        <div>
          <FieldLabel>Judgment status</FieldLabel>
          <ToneSelect
            valueKey="pj_judgment"
            defaultValue={data?.judgmentStatus ?? 'None'}
            options={['None', 'Entered', 'Stayed', 'Satisfied', 'Vacated', 'On Appeal']}
            plain
            {...selectProps}
          />
        </div>
        <div>
          <FieldLabel>Judgment date</FieldLabel>
          {textOrPlaceholder(data?.judgmentDate)}
        </div>
        <div>
          <FieldLabel>Judgment amount</FieldLabel>
          {textOrPlaceholder(data?.judgmentAmount)}
        </div>
        <div>
          <FieldLabel>Enforcement status</FieldLabel>
          <ToneSelect
            valueKey="pj_enforce"
            defaultValue={data?.enforcementStatus ?? 'Not Started'}
            options={[
              'Not Started',
              'Investigating Assets',
              'Active',
              'Stayed',
              'Collected',
              'Closed',
            ]}
            plain
            {...selectProps}
          />
        </div>
        <div>
          <FieldLabel>Enforcement deadline</FieldLabel>
          {textOrPlaceholder(data?.enforcementDeadline)}
        </div>
        <div>
          <FieldLabel>Enforcement actions</FieldLabel>
          {textOrPlaceholder(data?.enforcementActions)}
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: MUTED }}>
        This stage becomes active once judgment is entered.
      </div>
    </div>
  );
};
