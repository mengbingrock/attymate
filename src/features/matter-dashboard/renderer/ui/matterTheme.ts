/**
 * Shared visual tokens for the Matter Dashboard, ported from the v3 design
 * mock ("Matter Dashboard v3.dc.html"): a word→tone system colors statuses,
 * sides, and outcomes consistently across pills and selects.
 */

export const ACCENT = 'oklch(0.52 0.17 262)';
export const ACCENT_DARK = 'oklch(0.42 0.17 262)';
export const ACCENT_BG = 'oklch(0.95 0.03 262)';
export const ACCENT_FAINT_BG = 'oklch(0.97 0.012 262)';
export const RED = 'oklch(0.5 0.17 27)';
export const RED_BG = 'oklch(0.96 0.025 27)';
export const GREEN = 'oklch(0.46 0.11 152)';
export const GREEN_BG = 'oklch(0.955 0.035 152)';
export const INK = '#12161f';
export const MUTED = '#8a92a0';
export const FAINT = '#b6bcc7';
export const DIM = '#c6ccd6';
export const BODY = '#5b6472';
export const BORDER = '#e4e7ec';
export const HAIRLINE = '#f0f1f4';
export const PANEL_BG = '#f7f8fa';

export const EMPTY_VALUE = '—';

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
  'Rejected',
  'Expired',
  'No Settlement',
  'Stricken',
  'Dismissed',
  'Terminated',
  'Denied',
  'Superseded',
  'On Appeal',
  'Stayed',
  'Opposing',
]);

const GOOD_VALUES = new Set([
  'Complete',
  'Completed',
  'Resolved',
  'Admitted',
  'Accepted',
  'Executed',
  'Settled',
  'Satisfied',
  'Collected',
  'Confirmed',
  'Operative',
  'Granted',
  'Filed',
  'Served',
  'Prepared',
  'Established',
  'Lead counsel',
]);

const LIVE_VALUES = new Set([
  'Active',
  'Producing',
  'Issued',
  'In Review',
  'Marked',
  'Entered',
  'Tentative',
  'In Progress',
  'Investigating Assets',
  'Scheduled',
  'Proposed',
  'Countered',
  'Responded',
  'Set',
  'Pending',
  'Partially Resolved',
  'Partially Accepted',
  'Partially Settled',
  'Awaiting Response',
  'Continued',
  'Granted in Part',
  'Our client',
]);

export function toneFor(value: string): { bg: string; fg: string } {
  if (DANGER_VALUES.has(value)) return { bg: RED_BG, fg: RED };
  if (GOOD_VALUES.has(value)) return { bg: GREEN_BG, fg: GREEN };
  if (LIVE_VALUES.has(value)) return { bg: ACCENT_BG, fg: ACCENT_DARK };
  return { bg: '#fff', fg: INK };
}

// ── Canonical option lists (v3 mock) ──

export const MATTER_STATUSES = ['Active', 'Pending', 'Closed'] as const;

export const PARTY_SIDES = ['Our client', 'Opposing', 'Co-party', 'Third party', 'Other'] as const;
export const PARTY_KINDS = [
  'Individual',
  'Corporation',
  'LLC',
  'Partnership',
  'Government',
  'Trust',
  'Other',
] as const;
export const COUNSEL_ROLES = [
  'Lead counsel',
  'Co-counsel',
  'Associate',
  'Local counsel',
  'Of counsel',
  'In-house',
  'Self-represented',
] as const;

export const PLEADING_STATUSES = [
  'Draft',
  'Filed',
  'Served',
  'Operative',
  'Superseded',
  'Dismissed',
  'Stricken',
  'Resolved',
] as const;

export const REQUEST_TYPES = [
  'RFP',
  'RFA',
  'Special Interrogatories',
  'Form Interrogatories',
  'Deposition Notice',
  'Subpoena',
  'Inspection Demand',
  'Expert Discovery',
  'Other',
] as const;
export const REQUEST_STATUSES = [
  'Draft',
  'Issued',
  'Served',
  'Responded',
  'Producing',
  'Complete',
  'Disputed',
  'Withdrawn',
] as const;
export const MOTION_OUTCOMES = [
  'Pending',
  'Granted',
  'Granted in Part',
  'Denied',
  'Off Calendar',
  'Withdrawn',
] as const;
export const MEET_CONFER_METHODS = [
  'Letter',
  'Email',
  'Telephone',
  'Videoconference',
  'In Person',
  'Other',
] as const;
export const MEET_CONFER_OUTCOMES = [
  'Resolved',
  'Partially Resolved',
  'Unresolved',
  'Awaiting Response',
  'Impasse',
] as const;
export const PRODUCTION_TYPES = [
  'Initial',
  'Supplemental',
  'Corrected',
  'Rolling',
  'Privilege Log',
] as const;
export const DEPOSITION_REVIEWS = [
  'Not Started',
  'In Review',
  'Complete',
  'Needs Follow-up',
] as const;

export const TRIAL_TYPES = ['Court Trial', 'Jury Trial', 'Bifurcated'] as const;
export const TRIAL_SETTING_STATUSES = [
  'Set',
  'Confirmed',
  'Continued',
  'Vacated',
  'Completed',
] as const;
export const PRETRIAL_STATUSES = [
  'Not Started',
  'Prepared',
  'Filed',
  'Served',
  'Complete',
] as const;
export const WITNESS_ROLES = ['Fact', 'Expert', 'PMQ', 'Custodian', 'Impeachment'] as const;
export const WITNESS_AVAILABILITIES = ['Confirmed', 'Tentative', 'Conflict', 'Unknown'] as const;
export const EXHIBIT_ADMISSIONS = [
  'Proposed',
  'Marked',
  'Admitted',
  'Excluded',
  'Withdrawn',
] as const;
export const EXHIBIT_FOUNDATIONS = ['Established', 'In Progress', 'Needs Follow-up'] as const;
export const MIL_OUTCOMES = [
  'Pending',
  'Granted',
  'Granted in Part',
  'Denied',
  'Withdrawn',
] as const;

export const SETTLEMENT_TYPES = ['Demand', 'Offer', 'Counteroffer', 'Mediator Proposal'] as const;
export const SETTLEMENT_OUTCOMES = [
  'Proposed',
  'Accepted',
  'Partially Accepted',
  'Countered',
  'Rejected',
  'Expired',
  'Withdrawn',
] as const;
export const MEDIATION_STATUSES = ['Scheduled', 'Completed', 'Cancelled', 'Continued'] as const;
export const MEDIATION_RESULTS = [
  'Pending',
  'Settled',
  'Partially Settled',
  'No Settlement',
] as const;

export const JUDGMENT_STATUSES = [
  'Not Entered',
  'Entered',
  'Renewed',
  'Satisfied',
  'On Appeal',
  'Stayed',
] as const;
export const ENFORCEMENT_STATUSES = [
  'Not Started',
  'Investigating Assets',
  'In Progress',
  'Collected',
  'Satisfied',
  'Suspended',
] as const;

export const EVENT_TYPES = [
  'Filed',
  'Served',
  'Responded',
  'Order',
  'Ruling',
  'Hearing',
  'Deposition',
  'Production',
  'Meet and Confer',
  'Mediation',
  'Settlement',
  'Other',
] as const;
export const EVENT_GROUPS = [
  'Core',
  'Pleading',
  'Discovery',
  'Trial',
  'Settlement',
  'Mediation',
  'Post-Judgment',
] as const;
