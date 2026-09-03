import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThreadSecondaryPanel } from './ThreadSecondaryPanel.js';
import { emptySecondaryPanelState, openNewTab, openSecondaryPanel, selectPinnedView } from './threadSecondaryPanelState.js';

const noop = () => undefined;

describe('ThreadSecondaryPanel chrome', () => {
  it('renders Info, New Tab, maximize, and hide controls', () => {
    const html = renderToStaticMarkup(
      <ThreadSecondaryPanel
        state={openSecondaryPanel(emptySecondaryPanelState())}
        showDiffPin
        onSelectInfo={noop}
        onSelectDiff={noop}
        onNewTab={noop}
        onCloseTab={noop}
        onActivateTab={noop}
        onToggleMaximized={noop}
        onHide={noop}
        onResize={noop}
      >
        <div>body</div>
      </ThreadSecondaryPanel>
    );
    expect(html).toContain('data-testid="thread-secondary-panel"');
    expect(html).toContain('data-testid="thread-info-pin"');
    expect(html).toContain('data-testid="thread-diff-pin"');
    expect(html).not.toContain('data-testid="thread-plan-pin"');
    expect(html).toContain('data-testid="thread-secondary-new-tab"');
    expect(html).toContain('data-testid="thread-secondary-hide"');
    expect(html).toContain('aria-pressed="true"');
  });

  it('renders a footer slot for inspector actions', () => {
    const html = renderToStaticMarkup(
      <ThreadSecondaryPanel
        state={openSecondaryPanel(emptySecondaryPanelState())}
        footer={<button type="button">Delete</button>}
        onSelectInfo={noop}
        onSelectDiff={noop}
        onNewTab={noop}
        onCloseTab={noop}
        onActivateTab={noop}
        onToggleMaximized={noop}
        onHide={noop}
        onResize={noop}
      >
        <div>body</div>
      </ThreadSecondaryPanel>
    );
    expect(html).toContain('data-testid="thread-secondary-footer"');
    expect(html).toContain('Delete');
  });

  it('renders closable New Tab pills', () => {
    const html = renderToStaticMarkup(
      <ThreadSecondaryPanel
        state={openNewTab(selectPinnedView(emptySecondaryPanelState(), 'info'))}
        onSelectInfo={noop}
        onSelectDiff={noop}
        onNewTab={noop}
        onCloseTab={noop}
        onActivateTab={noop}
        onToggleMaximized={noop}
        onHide={noop}
        onResize={noop}
      >
        body
      </ThreadSecondaryPanel>
    );
    expect(html).toContain('New Tab');
    expect(html).toContain('Close New Tab');
  });

  it('shows the restore control when maximized', () => {
    const html = renderToStaticMarkup(
      <ThreadSecondaryPanel
        state={{ ...openSecondaryPanel(emptySecondaryPanelState()), isMaximized: true }}
        onSelectInfo={noop}
        onSelectDiff={noop}
        onNewTab={noop}
        onCloseTab={noop}
        onActivateTab={noop}
        onToggleMaximized={noop}
        onHide={noop}
        onResize={noop}
      >
        body
      </ThreadSecondaryPanel>
    );
    expect(html).toContain('Restore conversation');
    expect(html).toContain('is-maximized');
  });

  it('renders the Plan pin when plan chrome is available', () => {
    const html = renderToStaticMarkup(
      <ThreadSecondaryPanel
        state={selectPinnedView(emptySecondaryPanelState(), 'plan')}
        showPlanPin
        onSelectInfo={noop}
        onSelectDiff={noop}
        onSelectPlan={noop}
        onNewTab={noop}
        onCloseTab={noop}
        onActivateTab={noop}
        onToggleMaximized={noop}
        onHide={noop}
        onResize={noop}
      >
        body
      </ThreadSecondaryPanel>
    );
    expect(html).toContain('data-testid="thread-plan-pin"');
    expect(html).toContain('aria-label="Show plan"');
    expect(html).toContain('aria-pressed="true"');
  });
});
