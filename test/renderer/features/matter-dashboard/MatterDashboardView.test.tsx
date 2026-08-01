import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { MatterDashboardView } from '@features/matter-dashboard/renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MatterSnapshotDto } from '@features/matter-dashboard/contracts';
import type { Root } from 'react-dom/client';

const matterGetMock = vi.hoisted(() => vi.fn());
const applyProposalMock = vi.hoisted(() => vi.fn());
const rejectProposalMock = vi.hoisted(() => vi.fn());

vi.mock('@renderer/api', () => ({
  api: {
    matter: {
      get: matterGetMock,
      applyProposal: applyProposalMock,
      rejectProposal: rejectProposalMock,
    },
    teams: {
      onTeamChange: () => (): void => undefined,
    },
  },
}));

describe('MatterDashboardView', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    matterGetMock.mockReset();
    applyProposalMock.mockReset();
    rejectProposalMock.mockReset();
    matterGetMock.mockResolvedValue({ matter: null, proposal: null });
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

  function stageButton(label: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll('button')).find((el) =>
      el.textContent?.includes(label)
    );
    if (!button) throw new Error(`stage button "${label}" not found`);
    return button;
  }

  it('renders the matter card and defaults to the discovery stage detail', () => {
    renderView();
    expect(container.textContent).toContain('Anderson v. Meridian Logistics, Inc.');
    expect(container.textContent).toContain('Next deadline');
    expect(container.textContent).toContain('Meet & confer · Jun 3, 2026');
    expect(container.textContent).toContain('Pending motion');
  });

  it('switches the detail pane when a stage is selected', () => {
    renderView();
    act(() => {
      stageButton('Trial').click();
    });
    expect(container.textContent).toContain('Pretrial deadlines');
    act(() => {
      stageButton('Post-Judgment').click();
    });
    expect(container.textContent).toContain('This stage becomes active once judgment is entered.');
    act(() => {
      stageButton('Pleading').click();
    });
    expect(container.textContent).toContain('Causes of action / affirmative defenses');
  });

  it('keeps edited field values in state', () => {
    renderView();
    const clientInput = Array.from(container.querySelectorAll('input')).find(
      (el) => el.value === 'Daniel Anderson'
    );
    if (!clientInput) throw new Error('client field not found');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(clientInput, 'Dana Anderson');
      clientInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(
      Array.from(container.querySelectorAll('input')).some((el) => el.value === 'Dana Anderson')
    ).toBe(true);
  });

  it('hides required markers when showRequiredMarkers is off', () => {
    renderView({ showRequiredMarkers: false });
    expect(container.querySelectorAll('[title="Required field"]')).toHaveLength(0);
    renderView({ showRequiredMarkers: true });
    expect(container.querySelectorAll('[title="Required field"]').length).toBeGreaterThan(0);
  });

  async function renderViewAsync(
    props?: React.ComponentProps<typeof MatterDashboardView>
  ): Promise<void> {
    await act(async () => {
      root.render(<MatterDashboardView {...props} />);
      await Promise.resolve();
    });
  }

  it('shows the demo badge without live data and hides it when live data loads', async () => {
    renderView();
    expect(container.textContent).toContain('Demo data');

    matterGetMock.mockResolvedValue({
      matter: {
        schemaVersion: 1,
        updatedAt: '2026-08-01T10:00:00.000Z',
        updatedBy: 'team-lead',
        approvedBy: 'user',
        caption: 'Smith v. Jones Trucking',
      },
      proposal: null,
    } satisfies MatterSnapshotDto);
    await renderViewAsync({ teamName: 'signal-ops' });
    expect(container.textContent).not.toContain('Demo data');
    expect(container.textContent).toContain('Smith v. Jones Trucking');
    expect(container.textContent).toContain('Updated 2026-08-01T10:00:00.000Z by @team-lead');
    expect(container.textContent).toContain('approved by user');
  });

  it('overlays live section values on the demo fixture', async () => {
    matterGetMock.mockResolvedValue({
      matter: {
        schemaVersion: 1,
        caption: 'Smith v. Jones Trucking',
        matterNumber: 'SJ-2026-0001',
        currentStage: 'trial',
        nextDeadline: { date: 'Sep 12, 2026', label: 'Expert disclosures' },
        trial: { trialDate: 'Mar 3, 2027' },
      },
      proposal: null,
    } satisfies MatterSnapshotDto);
    await renderViewAsync({ teamName: 'signal-ops' });

    expect(container.textContent).toContain('SJ-2026-0001');
    expect(container.textContent).toContain('Sep 12, 2026 — Expert disclosures');
    // currentStage=trial makes the trial pane the default detail view.
    expect(container.textContent).toContain('Pretrial deadlines');
    expect(container.textContent).toContain('Mar 3, 2027');
    // Untouched sections render empty for a live matter — never demo fiction.
    expect(container.textContent).not.toContain('Witness & exhibit lists');
    expect(container.textContent).toContain('No pretrial deadlines recorded yet.');
  });

  it('renders the proposal review panel and wires approve/reject actions', async () => {
    const snapshot: MatterSnapshotDto = {
      matter: { schemaVersion: 1, caption: 'Smith v. Jones Trucking' },
      proposal: {
        schemaVersion: 1,
        proposedAt: '2026-08-01T12:00:00.000Z',
        proposedBy: 'team-lead',
        summary: ['Motion to compel filed Jul 10, 2026'],
        changes: { discovery: { pendingMotion: { filed: 'Jul 10, 2026' } } },
        taskRefs: ['task-1234abcd'],
      },
    };
    matterGetMock.mockResolvedValue(snapshot);
    applyProposalMock.mockResolvedValue({ matter: snapshot.matter, proposal: null });
    rejectProposalMock.mockResolvedValue({ matter: snapshot.matter, proposal: null });

    await renderViewAsync({ teamName: 'signal-ops' });
    expect(container.textContent).toContain('Proposed dashboard update');
    expect(container.textContent).toContain('Motion to compel filed Jul 10, 2026');
    expect(container.textContent).toContain('#task-123');

    const approveButton = Array.from(container.querySelectorAll('button')).find((el) =>
      el.textContent?.includes('Approve & update')
    );
    if (!approveButton) throw new Error('approve button not found');
    await act(async () => {
      approveButton.click();
      await Promise.resolve();
    });
    expect(applyProposalMock).toHaveBeenCalledWith('signal-ops');
    // Approving clears the proposal panel.
    expect(container.textContent).not.toContain('Proposed dashboard update');

    matterGetMock.mockResolvedValue(snapshot);
    await renderViewAsync({ teamName: 'other-team' });
    const rejectButton = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent === 'Reject'
    );
    if (!rejectButton) throw new Error('reject button not found');
    await act(async () => {
      rejectButton.click();
      await Promise.resolve();
    });
    expect(rejectProposalMock).toHaveBeenCalledWith('other-team', undefined);
  });

  it('renders empty values, not demo data, when an initialized empty matter exists', async () => {
    matterGetMock.mockResolvedValue({
      matter: { schemaVersion: 1 },
      proposal: null,
    } satisfies MatterSnapshotDto);
    await renderViewAsync({ teamName: 'fresh-team' });

    expect(container.textContent).toContain('New matter');
    expect(container.textContent).toContain('No matter updates yet');
    expect(container.textContent).not.toContain('Demo data');
    expect(container.textContent).not.toContain('Anderson v. Meridian');
    expect(container.textContent).not.toContain('Daniel Anderson');
    expect(container.textContent).not.toContain('Next deadline');
    // Discovery is the default stage: its collections start empty.
    expect(container.textContent).toContain('No requests recorded yet.');
    expect(container.textContent).toContain('None recorded yet.');
  });
});
