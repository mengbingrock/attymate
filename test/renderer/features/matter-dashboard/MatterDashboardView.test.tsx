import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { MatterDashboardView } from '@features/matter-dashboard/renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Root } from 'react-dom/client';

describe('MatterDashboardView', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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
});
