import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { MatterDashboardView } from '@features/matter-dashboard/renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MatterDto, MatterSnapshotDto } from '@features/matter-dashboard/contracts';
import type { Root } from 'react-dom/client';

const matterGetMock = vi.hoisted(() => vi.fn());
const matterUpdateMock = vi.hoisted(() => vi.fn());
const matterCreateMock = vi.hoisted(() => vi.fn());
const linkTeamMock = vi.hoisted(() => vi.fn());
const unlinkTeamMock = vi.hoisted(() => vi.fn());
const applyProposalMock = vi.hoisted(() => vi.fn());
const rejectProposalMock = vi.hoisted(() => vi.fn());

vi.mock('@renderer/api', () => ({
  api: {
    matter: {
      get: matterGetMock,
      update: matterUpdateMock,
      create: matterCreateMock,
      linkTeam: linkTeamMock,
      unlinkTeam: unlinkTeamMock,
      applyProposal: applyProposalMock,
      rejectProposal: rejectProposalMock,
      onMattersChanged: () => (): void => undefined,
    },
    teams: {
      onTeamChange: () => (): void => undefined,
    },
  },
}));

const LIVE_MATTER: MatterDto = {
  id: 'm-1',
  schemaVersion: 2,
  caption: 'Smith v. Jones Trucking',
  status: 'Active',
  matterNumber: 'SJ-2026-0001',
  client: 'A. Smith',
  currentStage: 'trial',
  updatedAt: '2026-08-01T10:00:00.000Z',
  coreFields: [{ label: 'Client', value: 'A. Smith' }],
  nextDeadline: { date: 'Sep 12, 2026', label: 'Expert disclosures' },
  trial: { settings: [{ id: 'ts-1', type: 'Jury Trial', trialDate: 'Mar 3, 2027' }] },
};

function snapshotOf(
  matters: MatterDto[],
  linked: string[] = matters.map((matter) => matter.id),
  proposal: MatterSnapshotDto['proposal'] = null
): MatterSnapshotDto {
  return { matters, linkedMatterIds: linked, proposal };
}

describe('MatterDashboardView', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    matterGetMock.mockReset();
    matterUpdateMock.mockReset();
    matterCreateMock.mockReset();
    applyProposalMock.mockReset();
    rejectProposalMock.mockReset();
    matterGetMock.mockResolvedValue(snapshotOf([]));
    matterUpdateMock.mockResolvedValue(snapshotOf([LIVE_MATTER]));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function renderView(props?: React.ComponentProps<typeof MatterDashboardView>): void {
    act(() => {
      root.render(<MatterDashboardView {...props} />);
    });
  }

  async function renderViewAsync(
    props?: React.ComponentProps<typeof MatterDashboardView>
  ): Promise<void> {
    await act(async () => {
      root.render(<MatterDashboardView {...props} />);
      await Promise.resolve();
    });
  }

  function findButton(label: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll('button')).find((el) =>
      el.textContent?.includes(label)
    );
    if (!button) throw new Error(`button "${label}" not found`);
    return button;
  }

  /** Stage-rail rows are clickable divs; find the innermost one. */
  function findClickable(label: string): HTMLElement {
    const candidates = Array.from(container.querySelectorAll<HTMLElement>('div, button')).filter(
      (el) => el.textContent?.includes(label) && (el.style.cursor === 'pointer' || el.tagName === 'BUTTON')
    );
    const target = candidates.at(-1);
    if (!target) throw new Error(`clickable "${label}" not found`);
    return target;
  }

  function findRow(text: string): HTMLElement {
    const row = Array.from(container.querySelectorAll('div')).find(
      (el) => el.textContent?.includes(text) && el.style.cursor === 'pointer'
    );
    if (!row) throw new Error(`row "${text}" not found`);
    return row;
  }

  it('renders the demo matter in the list without a team', () => {
    renderView();
    expect(container.textContent).toContain('Matters');
    expect(container.textContent).toContain('Anderson v. Meridian Logistics, Inc.');
  });

  it('opens a matter from the list and shows the five-stage rail', () => {
    renderView();
    act(() => {
      findRow('Anderson v. Meridian Logistics, Inc.').click();
    });
    expect(container.textContent).toContain('← All matters');
    expect(container.textContent).toContain('Settlement & Mediation');
    expect(container.textContent).toContain('Post-Judgment');
    // Demo matter's currentStage is discovery.
    expect(container.textContent).toContain('Requests');
  });

  it('switches stage panes, including the new settlement pane', () => {
    renderView();
    act(() => {
      findRow('Anderson v. Meridian Logistics, Inc.').click();
    });
    act(() => {
      findClickable('Settlement & Mediation').click();
    });
    expect(container.textContent).toContain('Settlement records');
    expect(container.textContent).toContain('Mediation');
    act(() => {
      findClickable('Trial').click();
    });
    expect(container.textContent).toContain('Pretrial deadlines');
  });

  it('shows the procedural history tab with derived events', () => {
    renderView();
    act(() => {
      findRow('Anderson v. Meridian Logistics, Inc.').click();
    });
    act(() => {
      findButton('Procedural History').click();
    });
    expect(container.textContent).toContain('Procedural History');
    // Auto-derived from the demo matter's motion records.
    expect(container.textContent).toContain('Motion to Compel Further Responses');
  });

  it('lists live matters and persists an inline edit through the update API', async () => {
    matterGetMock.mockResolvedValue(snapshotOf([LIVE_MATTER]));
    await renderViewAsync({ teamName: 'signal-ops' });

    expect(container.textContent).toContain('Smith v. Jones Trucking');
    expect(container.textContent).not.toContain('Anderson v. Meridian');

    await act(async () => {
      findRow('Smith v. Jones Trucking').click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('SJ-2026-0001');
    // currentStage=trial selects the trial pane by default.
    expect(container.textContent).toContain('Pretrial deadlines');
    expect(container.textContent).toContain('Mar 3, 2027');

    const clientInput = Array.from(container.querySelectorAll('input')).find(
      (el) => el.value === 'A. Smith'
    );
    if (!clientInput) throw new Error('client field not found');
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;
    act(() => {
      setter?.call(clientInput, 'Dana Smith');
      clientInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(
      Array.from(container.querySelectorAll('input')).some((el) => el.value === 'Dana Smith')
    ).toBe(true);

    // The debounced flush persists the edit as a user-authored change.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
    expect(matterUpdateMock).toHaveBeenCalled();
    const [teamArg, matterArg] = matterUpdateMock.mock.calls.at(-1) as [string, string, unknown];
    expect(teamArg).toBe('signal-ops');
    expect(matterArg).toBe('m-1');
  });

  it('renders the proposal review panel and wires approve/reject actions', async () => {
    const proposal = {
      schemaVersion: 2 as const,
      matterId: 'm-1',
      proposedAt: '2026-08-02T12:00:00.000Z',
      proposedBy: 'team-lead',
      summary: ['Motion to compel filed Jul 10, 2026'],
      changes: { discovery: { motions: [{ id: 'mo-1', type: 'MTC', filed: 'Jul 10, 2026' }] } },
      taskRefs: ['task-1234abcd'],
    };
    matterGetMock.mockResolvedValue(snapshotOf([LIVE_MATTER], ['m-1'], proposal));
    applyProposalMock.mockResolvedValue(snapshotOf([LIVE_MATTER]));
    rejectProposalMock.mockResolvedValue(snapshotOf([LIVE_MATTER]));

    await renderViewAsync({ teamName: 'signal-ops' });
    expect(container.textContent).toContain('Proposed dashboard update');
    expect(container.textContent).toContain('Motion to compel filed Jul 10, 2026');
    expect(container.textContent).toContain('Target matter: Smith v. Jones Trucking');
    expect(container.textContent).toContain('#task-123');

    // The matter changed after the proposal was submitted → staleness note.
    expect(container.textContent).not.toContain('changed after this proposal');

    await act(async () => {
      findButton('Approve & update').click();
      await Promise.resolve();
    });
    expect(applyProposalMock).toHaveBeenCalledWith('signal-ops');
    expect(container.textContent).not.toContain('Proposed dashboard update');
  });

  it('flags a stale proposal when the matter changed after submission', async () => {
    const proposal = {
      schemaVersion: 2 as const,
      matterId: 'm-1',
      proposedAt: '2026-07-01T00:00:00.000Z',
      proposedBy: 'team-lead',
      summary: ['Old summary'],
      changes: { status: 'Closed' },
    };
    matterGetMock.mockResolvedValue(snapshotOf([LIVE_MATTER], ['m-1'], proposal));
    await renderViewAsync({ teamName: 'signal-ops' });
    expect(container.textContent).toContain('changed after this proposal');
  });

  it('creates a matter from the list and opens it', async () => {
    const created: MatterDto = { id: 'm-new', schemaVersion: 2, caption: 'New matter' };
    matterGetMock.mockResolvedValue(snapshotOf([]));
    matterCreateMock.mockResolvedValue(snapshotOf([created]));
    await renderViewAsync({ teamName: 'signal-ops' });

    await act(async () => {
      findButton('+ New matter').click();
      await Promise.resolve();
    });
    expect(matterCreateMock).toHaveBeenCalledWith('signal-ops', undefined);
    expect(container.textContent).toContain('← All matters');
  });
});
