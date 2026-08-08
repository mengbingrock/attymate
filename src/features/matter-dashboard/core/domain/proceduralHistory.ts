import type { MatterDto } from '../../contracts';

/**
 * One procedural-history timeline row. Auto entries are DERIVED from stage
 * records on every render — editing a source record updates its timeline
 * entry with zero sync machinery — while manual entries come from the stored
 * `events` array and are the only rows the user edits directly.
 */
export interface MatterEventView {
  id: string;
  date: string;
  time?: string;
  type: string;
  group: string;
  description: string;
  parties?: string;
  docs?: string;
  note?: string;
  sync: 'auto' | 'manual';
  /** Which record produced an auto entry, e.g. "discovery.motions[]". */
  sourceRef?: string;
}

function partyName(matter: MatterDto, partyId: string | undefined): string | undefined {
  if (!partyId) return undefined;
  return matter.parties?.find((party) => party.id === partyId)?.name;
}

function pushEvent(
  events: MatterEventView[],
  event: Partial<MatterEventView> & { id: string }
): void {
  if (!event.date || !event.description) return;
  events.push({
    type: 'Other',
    group: 'Core',
    sync: 'auto',
    ...event,
  } as MatterEventView);
}

/**
 * Derives the auto timeline from the matter's stage records and merges the
 * stored manual events, newest first (tolerant date parse; undated rows sink
 * to the end in stable order).
 */
export function deriveProceduralEvents(matter: MatterDto): MatterEventView[] {
  const events: MatterEventView[] = [];

  for (const record of matter.pleading?.records ?? []) {
    pushEvent(events, {
      id: `auto-pleading-${record.id}`,
      date: record.filed ?? record.served ?? '',
      type: 'Filed',
      group: 'Pleading',
      description: `${partyName(matter, record.partyId) ?? 'A party'} filed ${record.type}${
        record.status ? ` (${record.status})` : ''
      }.`,
      parties: partyName(matter, record.partyId),
      docs: record.type,
      note: record.claims,
      sourceRef: 'pleading.records[]',
    });
  }

  for (const request of matter.discovery?.requests ?? []) {
    pushEvent(events, {
      id: `auto-request-${request.id}`,
      date: request.served ?? request.issued ?? '',
      type: 'Served',
      group: 'Discovery',
      description: `${request.type}${request.set ? ` — ${request.set}` : ''} served${
        request.status ? ` (${request.status})` : ''
      }.`,
      parties: request.parties,
      note: request.due ? `Response due ${request.due}.` : undefined,
      sourceRef: 'discovery.requests[]',
    });
  }

  for (const motion of matter.discovery?.motions ?? []) {
    pushEvent(events, {
      id: `auto-motion-${motion.id}`,
      date: motion.ruled ?? motion.filed ?? '',
      type: motion.ruled ? 'Ruling' : 'Filed',
      group: 'Discovery',
      description: motion.ruled
        ? `${motion.type} ruled${motion.outcome ? `: ${motion.outcome}` : ''}.`
        : `${motion.movingParty ? `${motion.movingParty} filed ` : ''}${motion.type}${
            motion.outcome ? ` (${motion.outcome})` : ''
          }.`,
      parties: motion.movingParty,
      docs: motion.request,
      note: motion.hearing ? `Hearing ${motion.hearing}.` : undefined,
      sourceRef: 'discovery.motions[]',
    });
  }

  for (const entry of matter.discovery?.meetAndConfers ?? []) {
    pushEvent(events, {
      id: `auto-mc-${entry.id}`,
      date: entry.date ?? '',
      type: 'Meet and Confer',
      group: 'Discovery',
      description: `Meet and confer${entry.method ? ` (${entry.method})` : ''}${
        entry.outcome ? `: ${entry.outcome}` : ''
      }.`,
      parties: entry.participants,
      note: entry.next,
      sourceRef: 'discovery.meetAndConfers[]',
    });
  }

  for (const production of matter.discovery?.productions ?? []) {
    pushEvent(events, {
      id: `auto-production-${production.id}`,
      date: production.date ?? '',
      type: 'Production',
      group: 'Discovery',
      description: `${production.party ? `${production.party} served ` : ''}${
        production.type
      } production${production.bates ? `, ${production.bates}` : ''}.`,
      parties: production.party,
      sourceRef: 'discovery.productions[]',
    });
  }

  for (const deposition of matter.discovery?.depositions ?? []) {
    pushEvent(events, {
      id: `auto-deposition-${deposition.id}`,
      date: deposition.taken ?? '',
      type: 'Deposition',
      group: 'Discovery',
      description: `Deposition of ${deposition.name}${
        deposition.review ? ` (${deposition.review})` : ''
      }.`,
      note: deposition.note,
      sourceRef: 'discovery.depositions[]',
    });
  }

  for (const setting of matter.trial?.settings ?? []) {
    pushEvent(events, {
      id: `auto-setting-${setting.id}`,
      date: setting.setAt ?? '',
      type: 'Order',
      group: 'Trial',
      description: `${setting.type ?? 'Trial'} ${setting.status === 'Continued' ? 'continued to' : 'set for'} ${
        setting.trialDate ?? 'TBD'
      }${setting.venue ? ` · ${setting.venue}` : ''}.`,
      sourceRef: 'trial.settings[]',
    });
  }

  for (const record of matter.settlement?.records ?? []) {
    pushEvent(events, {
      id: `auto-settlement-${record.id}`,
      date: record.date ?? '',
      type: 'Settlement',
      group: 'Settlement',
      description: `${record.type ?? 'Settlement record'}${
        record.amount ? ` of ${record.amount}` : ''
      }${record.outcome ? ` (${record.outcome})` : ''}.`,
      parties: record.parties,
      note: record.terms,
      sourceRef: 'settlement.records[]',
    });
  }

  for (const mediation of matter.settlement?.mediations ?? []) {
    pushEvent(events, {
      id: `auto-mediation-${mediation.id}`,
      date: mediation.when ?? '',
      type: 'Mediation',
      group: 'Mediation',
      description: `Mediation${mediation.mediator ? ` before ${mediation.mediator}` : ''}${
        mediation.status
          ? ` (${mediation.status}${
              mediation.result && mediation.result !== 'Pending' ? ` — ${mediation.result}` : ''
            })`
          : ''
      }.`,
      parties: mediation.participants,
      note: mediation.next,
      sourceRef: 'settlement.mediations[]',
    });
  }

  for (const action of matter.postJudgment?.enforcementActions ?? []) {
    pushEvent(events, {
      id: `auto-enforcement-${action.id}`,
      date: action.date ?? '',
      type: 'Order',
      group: 'Post-Judgment',
      description: `${action.action ?? 'Enforcement action'}${
        action.detail ? ` — ${action.detail}` : ''
      }${action.status ? ` (${action.status})` : ''}.`,
      sourceRef: 'postJudgment.enforcementActions[]',
    });
  }

  for (const event of matter.events ?? []) {
    events.push({
      id: event.id,
      date: event.date,
      time: event.time,
      type: event.type ?? 'Other',
      group: event.group ?? 'Core',
      description: event.description ?? '',
      parties: event.parties,
      docs: event.docs,
      note: event.note,
      sync: 'manual',
      sourceRef: event.sourceRef,
    });
  }

  return events.sort((left, right) => {
    const leftTime = Date.parse(left.date);
    const rightTime = Date.parse(right.date);
    if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
    if (Number.isNaN(leftTime)) return 1;
    if (Number.isNaN(rightTime)) return -1;
    return rightTime - leftTime;
  });
}
