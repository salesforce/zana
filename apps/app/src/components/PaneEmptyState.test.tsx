/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaneEmptyState } from './PaneEmptyState.js';

describe('PaneEmptyState', () => {
  it('renders title, hint, art, and children', () => {
    const html = renderToStaticMarkup(
      <PaneEmptyState art="ended" title="Gone" hint="Close this pane." testId="empty">
        <button type="button">Retry</button>
      </PaneEmptyState>
    );
    expect(html).toContain('data-testid="empty"');
    expect(html).toContain('data-art="ended"');
    expect(html).toContain('class="pane-empty"');
    expect(html).toContain('pane-empty-art');
    expect(html).toContain('pane-empty-term');
    expect(html).toContain('pane-empty-title');
    expect(html).toContain('Gone');
    expect(html).toContain('pane-empty-hint');
    expect(html).toContain('Close this pane.');
    expect(html).toContain('Retry');
  });

  it('renders each art variant', () => {
    expect(renderToStaticMarkup(<PaneEmptyState art="ended" title="A" />)).toContain('data-art="ended"');
    expect(renderToStaticMarkup(<PaneEmptyState art="missing" title="A" />)).toContain('data-art="missing"');
    expect(renderToStaticMarkup(<PaneEmptyState art="agents" title="A" />)).toContain('data-art="agents"');
    expect(renderToStaticMarkup(<PaneEmptyState art="error" title="A" />)).toContain('data-art="error"');
    expect(renderToStaticMarkup(<PaneEmptyState art="inbox" title="A" />)).toContain('data-art="inbox"');
  });

  it('omits the hint when none is passed', () => {
    const html = renderToStaticMarkup(<PaneEmptyState art="agents" title="No agents" />);
    expect(html).toContain('No agents');
    expect(html).not.toContain('pane-empty-hint');
  });

  it('appends an extra className', () => {
    const html = renderToStaticMarkup(
      <PaneEmptyState art="missing" title="Missing" className="extra-slot" />
    );
    expect(html).toContain('class="pane-empty extra-slot"');
  });
});
