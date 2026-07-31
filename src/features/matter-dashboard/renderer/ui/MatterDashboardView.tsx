import { memo, useCallback, useState } from 'react';

/**
 * Matter Dashboard — React port of the "Matter Dashboard v2" Claude Design
 * component (claude.ai/design project 2184a839, `Matter Dashboard v2.dc.html`).
 *
 * The design ships with a demo litigation matter (Anderson v. Meridian
 * Logistics) baked in; the matter content below is that fixture data, not
 * localized app chrome. Field edits and stage selection are kept in local
 * component state, mirroring the original DCLogic behavior.
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
      {options.map((option) => (
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

const STAGE_META: readonly { id: StageId; label: string; dates: string; summary: string }[] = [
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

const CORE_FIELDS: readonly { l: string; v: string; req?: boolean }[] = [
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

const SYS_FIELDS: readonly { l: string; v: string }[] = [
  { l: 'Matter ID', v: '3f8a1c2e-7b4d-4e90-a1f3-6c2d5e8b9b7d' },
  { l: 'Control issue', v: 'CTL-0148' },
  { l: 'Created', v: '2025-03-12 09:14' },
  { l: 'Updated', v: '2026-07-29 16:42' },
];

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

const REQUESTS: readonly {
  k: string;
  type: string;
  set: string;
  parties: string;
  served: string;
  due: string;
  status: string;
}[] = [
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

const PRODUCTIONS: readonly { k: string; type: string; bates: string; date: string }[] = [
  { k: 'p1', type: 'Initial', bates: 'MER000001–004212', date: 'Oct 14, 2025' },
  { k: 'p2', type: 'Supplemental', bates: 'MER004213–005871', date: 'Jan 22, 2026' },
];
const PRODUCTION_TYPES = ['Initial', 'Supplemental', 'Corrected', 'Rolling', 'Privilege Log'];

const DEPO_OPTS = ['Not Started', 'In Review', 'Complete', 'Needs Follow-up'];
const DEPOSITIONS: readonly {
  k: string;
  name: string;
  taken: string;
  review: string;
  note: string;
  noteColor: string;
}[] = [
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

const MOTION_TEXT_FIELDS: readonly { k: string; l: string; v: string; vc?: string }[] = [
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

const PRETRIAL_STATUSES = ['Not Started', 'Prepared', 'Filed', 'Served', 'Complete'];
const PRETRIAL: readonly { k: string; t: string; d: string; src: string; s: string }[] = [
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
const WITNESSES: readonly {
  k: string;
  name: string;
  role: string;
  party: string;
  avail: string;
}[] = [
  { k: 'w1', name: 'D. Anderson', role: 'Fact', party: 'Plaintiff', avail: 'Confirmed' },
  { k: 'w2', name: 'K. Ramos', role: 'PMQ', party: 'Defendant', avail: 'Tentative' },
  { k: 'w3', name: 'Dr. E. Chou', role: 'Expert', party: 'Plaintiff', avail: 'Confirmed' },
];

const EXHIBIT_ADMISSIONS = ['Proposed', 'Marked', 'Admitted', 'Excluded', 'Withdrawn'];
const EXHIBITS: readonly { k: string; num: string; title: string; adm: string }[] = [
  { k: 'x1', num: '101', title: 'Master Services Agreement', adm: 'Proposed' },
  { k: 'x2', num: '102', title: 'Delivery logs 2024–2025', adm: 'Proposed' },
  { k: 'x3', num: '201', title: 'Meridian operations manual', adm: 'Marked' },
];

interface MatterDashboardViewProps {
  /** Which case stage is currently in progress. Defaults to discovery. */
  currentStage?: StageId;
  /** Show required-field markers next to fields the intake contract requires. */
  showRequiredMarkers?: boolean;
}

export const MatterDashboardView = memo(function MatterDashboardView({
  currentStage = 'discovery',
  showRequiredMarkers = true,
}: MatterDashboardViewProps): React.JSX.Element {
  const [selectedStage, setSelectedStage] = useState<StageId | null>(null);
  const [vals, setVals] = useState<Vals>({});
  const setVal = useCallback<SetVal>((key, value) => {
    setVals((prev) => ({ ...prev, [key]: value }));
  }, []);

  const currentIndex = STAGE_ORDER.includes(currentStage)
    ? STAGE_ORDER.indexOf(currentStage)
    : STAGE_ORDER.indexOf('discovery');
  const activeStage: StageId = selectedStage ?? STAGE_ORDER[currentIndex];
  const reqOn = showRequiredMarkers;
  const requiredMark = (
    <span title="Required field" style={{ color: ACCENT, fontWeight: 700 }}>
      {' '}
      *
    </span>
  );

  const selectProps = { vals, setVal };

  return (
    <div
      style={{
        background: '#eef0f3',
        borderRadius: 14,
        color: INK,
        fontSize: 14,
      }}
    >
      <div
        style={{
          maxWidth: 1440,
          margin: '0 auto',
          padding: 20,
          display: 'grid',
          gridTemplateColumns: 'minmax(280px, 340px) minmax(0, 1fr)',
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
              Anderson v. Meridian Logistics, Inc.
              {reqOn && requiredMark}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0 16px' }}>
              <ToneSelect
                valueKey="core_status"
                defaultValue="Active"
                options={['Planned', 'Active', 'Completed', 'Archived']}
                {...selectProps}
              />
              {reqOn && requiredMark}
              <span style={{ fontSize: 12.5, color: MUTED }}>AM-2025-0148</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {CORE_FIELDS.map((field) => (
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
                    {reqOn && field.req && requiredMark}
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
                {SYS_FIELDS.map((field) => (
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
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              Aug 14, 2026 — Opposition to Motion to Compel
            </div>
          </div>
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
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(200px, 240px) minmax(0, 1fr)',
              gap: 24,
              alignItems: 'start',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {STAGE_META.map((stage, index) => {
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
                      <div style={{ fontSize: 12, color: BODY, marginTop: 3 }}>{stage.summary}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{ borderLeft: `1px solid ${BORDER}`, paddingLeft: 24, minHeight: 420 }}>
              {activeStage === 'pleading' && <PleadingPane {...selectProps} />}
              {activeStage === 'discovery' && <DiscoveryPane {...selectProps} />}
              {activeStage === 'trial' && <TrialPane {...selectProps} />}
              {activeStage === 'post' && <PostJudgmentPane {...selectProps} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

interface PaneProps {
  vals: Vals;
  setVal: SetVal;
}

const PleadingPane = ({ vals, setVal }: PaneProps): React.JSX.Element => (
  <div>
    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
      Pleading{' '}
      <span style={{ fontWeight: 500, color: MUTED, fontSize: 13 }}>· completed Jun 2025</span>
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
          First Amended Complaint
        </span>
      </div>
      <div>
        <FieldLabel>Pleading type</FieldLabel>
        <ToneSelect
          valueKey="plead_type"
          defaultValue="Complaint"
          options={['Complaint', 'Answer', 'Cross-Complaint', 'Petition', 'Response', 'Other']}
          plain
          vals={vals}
          setVal={setVal}
        />
      </div>
      <div>
        <FieldLabel>Amendment deadline</FieldLabel>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>Jun 30, 2025 — passed</div>
      </div>
    </div>
    <FieldLabel>Causes of action / affirmative defenses</FieldLabel>
    <div style={{ fontSize: 13.5, lineHeight: 1.55, maxWidth: 760 }}>
      Breach of contract and negligence against Meridian Logistics. Answer filed Jun 9, 2025
      asserting 14 affirmative defenses, including statute of limitations and comparative fault.
    </div>
  </div>
);

const DiscoveryPane = ({ vals, setVal }: PaneProps): React.JSX.Element => {
  const selectProps = { vals, setVal };
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
        Discovery{' '}
        <span style={{ fontWeight: 500, color: ACCENT, fontSize: 13 }}>· in progress</span>
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
          overflow: 'hidden',
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.5fr 1.5fr 1.4fr 0.9fr 0.9fr 1.2fr',
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
        {REQUESTS.map((request) => (
          <div
            key={request.k}
            style={{
              display: 'grid',
              gridTemplateColumns: '1.5fr 1.5fr 1.4fr 0.9fr 0.9fr 1.2fr',
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: '14px 16px' }}>
          <PanelTitle>Meet &amp; confer · Jun 3, 2026</PanelTitle>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 2 }}>Method</div>
              <ToneSelect
                valueKey="mc_method"
                defaultValue="Videoconference"
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
                defaultValue="Unresolved"
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
            Privilege and completeness objections re{' '}
            <span className="hover:underline" style={{ color: ACCENT }}>
              Special Interrogatories — Set Two
            </span>
            . Next step: motion to compel; deadline reserved.
          </div>
        </div>
        <div
          style={{
            border: '1px solid oklch(0.9 0.04 27)',
            borderRadius: 10,
            background: 'oklch(0.985 0.008 27)',
            padding: '14px 16px',
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
            {MOTION_TEXT_FIELDS.map((field) => (
              <div
                key={field.k}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '110px 1fr',
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
                gridTemplateColumns: '110px 1fr',
                gap: 8,
                alignItems: 'center',
                fontSize: 12.5,
              }}
            >
              <span style={{ color: MUTED }}>Outcome</span>
              <span>
                <ToneSelect
                  valueKey="mo_outcome"
                  defaultValue="Pending"
                  options={MOTION_OUTCOMES}
                  small
                  {...selectProps}
                />
              </span>
            </div>
          </div>
        </div>
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: '14px 16px' }}>
          <PanelTitle>Productions</PanelTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {PRODUCTIONS.map((production) => (
              <div
                key={production.k}
                style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}
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
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: '14px 16px' }}>
          <PanelTitle>Depositions</PanelTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {DEPOSITIONS.map((deposition) => (
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

const TrialPane = ({ vals, setVal }: PaneProps): React.JSX.Element => {
  const selectProps = { vals, setVal };
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
        Trial <span style={{ fontWeight: 500, color: MUTED, fontSize: 13 }}>· upcoming</span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '14px 20px',
          marginBottom: 18,
        }}
      >
        <div>
          <FieldLabel>Trial date</FieldLabel>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>Feb 8, 2027</div>
        </div>
        <div>
          <FieldLabel>Trial type</FieldLabel>
          <ToneSelect
            valueKey="trial_type"
            defaultValue="Jury Trial"
            options={['Court Trial', 'Jury Trial']}
            plain
            {...selectProps}
          />
        </div>
        <div>
          <FieldLabel>Estimated duration</FieldLabel>
          <div style={{ fontSize: 13.5, fontWeight: 500 }}>7 days</div>
        </div>
        <div>
          <FieldLabel>Setting status</FieldLabel>
          <ToneSelect
            valueKey="trial_status"
            defaultValue="Set"
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
        {PRETRIAL.map((deadline) => (
          <div
            key={deadline.k}
            style={{
              display: 'grid',
              gridTemplateColumns: '1.8fr 0.9fr 1.1fr 1fr',
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: '14px 16px' }}>
          <PanelTitle>Witnesses</PanelTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {WITNESSES.map((witness) => (
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
            {EXHIBITS.map((exhibit) => (
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
        Continuances: none · Motions in limine, trial sessions, verdict and post-trial motions
        populate once trial begins.
      </div>
    </div>
  );
};

const PostJudgmentPane = ({ vals, setVal }: PaneProps): React.JSX.Element => {
  const selectProps = { vals, setVal };
  const placeholder = <div style={{ fontSize: 13.5, fontWeight: 500, color: FAINT }}>—</div>;
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
        Post-Judgment Enforcement{' '}
        <span style={{ fontWeight: 500, color: MUTED, fontSize: 13 }}>· not started</span>
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
            defaultValue="None"
            options={['None', 'Entered', 'Stayed', 'Satisfied', 'Vacated', 'On Appeal']}
            plain
            {...selectProps}
          />
        </div>
        <div>
          <FieldLabel>Judgment date</FieldLabel>
          {placeholder}
        </div>
        <div>
          <FieldLabel>Judgment amount</FieldLabel>
          {placeholder}
        </div>
        <div>
          <FieldLabel>Enforcement status</FieldLabel>
          <ToneSelect
            valueKey="pj_enforce"
            defaultValue="Not Started"
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
          {placeholder}
        </div>
        <div>
          <FieldLabel>Enforcement actions</FieldLabel>
          {placeholder}
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: MUTED }}>
        This stage becomes active once judgment is entered.
      </div>
    </div>
  );
};
