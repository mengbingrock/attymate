import { deriveProceduralEvents } from '@features/matter-dashboard/core/domain/proceduralHistory';
import { describe, expect, it } from 'vitest';

import type { MatterDto } from '@features/matter-dashboard/contracts';

const MATTER: MatterDto = {
  id: 'm-1',
  schemaVersion: 2,
  parties: [{ id: 'pty-a', name: 'Daniel Anderson' }],
  pleading: {
    records: [
      {
        id: 'pl-1',
        partyId: 'pty-a',
        type: 'First Amended Complaint',
        status: 'Operative',
        filed: 'May 19, 2025',
      },
    ],
  },
  discovery: {
    motions: [
      { id: 'mo-1', type: 'Motion to Compel', outcome: 'Pending', filed: 'Jul 10, 2026' },
      { id: 'mo-2', type: 'Protective Order', outcome: 'Denied', filed: 'Nov 14, 2025', ruled: 'Dec 15, 2025' },
    ],
    productions: [
      { id: 'pr-1', type: 'Initial', bates: 'MER000001–004212', date: 'Oct 14, 2025', party: 'Meridian' },
    ],
  },
  settlement: {
    mediations: [
      { id: 'md-1', when: 'Mar 26, 2026', status: 'Completed', result: 'No Settlement', mediator: 'L. Whitfield' },
    ],
  },
  events: [
    {
      id: 'ev-1',
      date: 'Mar 12, 2025',
      type: 'Filed',
      group: 'Core',
      description: 'Complaint filed; matter opened.',
    },
  ],
};

describe('deriveProceduralEvents', () => {
  it('derives auto events from records and merges manual events, newest first', () => {
    const events = deriveProceduralEvents(MATTER);

    const kinds = events.map((event) => `${event.sync}:${event.id}`);
    expect(kinds).toEqual([
      'auto:auto-motion-mo-1', // Jul 10, 2026
      'auto:auto-mediation-md-1', // Mar 26, 2026
      'auto:auto-motion-mo-2', // ruled Dec 15, 2025
      'auto:auto-production-pr-1', // Oct 14, 2025
      'auto:auto-pleading-pl-1', // May 19, 2025
      'manual:ev-1', // Mar 12, 2025
    ]);
  });

  it('names the filing party and the source record', () => {
    const events = deriveProceduralEvents(MATTER);
    const pleadingEvent = events.find((event) => event.id === 'auto-pleading-pl-1');
    expect(pleadingEvent?.description).toContain('Daniel Anderson filed First Amended Complaint');
    expect(pleadingEvent?.sourceRef).toBe('pleading.records[]');
    expect(pleadingEvent?.group).toBe('Pleading');
  });

  it('prefers the ruling date and type once a motion is ruled', () => {
    const events = deriveProceduralEvents(MATTER);
    const ruled = events.find((event) => event.id === 'auto-motion-mo-2');
    expect(ruled?.type).toBe('Ruling');
    expect(ruled?.date).toBe('Dec 15, 2025');
    expect(ruled?.description).toContain('Denied');
  });

  it('editing a source record updates its derived event (no stored copy)', () => {
    const edited: MatterDto = {
      ...MATTER,
      discovery: {
        ...MATTER.discovery,
        motions: MATTER.discovery?.motions?.map((motion) =>
          motion.id === 'mo-1' ? { ...motion, outcome: 'Granted' } : motion
        ),
      },
    };
    const event = deriveProceduralEvents(edited).find((entry) => entry.id === 'auto-motion-mo-1');
    expect(event?.description).toContain('Granted');
  });

  it('sinks undated records to the end instead of dropping them', () => {
    const withUndated: MatterDto = {
      ...MATTER,
      discovery: {
        ...MATTER.discovery,
        depositions: [{ id: 'dp-1', name: 'K. Ramos', taken: 'date TBD', review: 'Not Started' }],
      },
    };
    const events = deriveProceduralEvents(withUndated);
    expect(events.at(-1)?.id).toBe('auto-deposition-dp-1');
  });

  it('returns an empty list for an empty matter', () => {
    expect(deriveProceduralEvents({ id: 'm-0', schemaVersion: 2 })).toEqual([]);
  });
});
