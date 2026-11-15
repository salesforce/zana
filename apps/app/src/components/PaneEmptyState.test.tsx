/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaneEmptyState, type PaneEmptyArt } from './PaneEmptyState.js';

const ARTS: PaneEmptyArt[] = [
  'conversation', 'first-turn', 'inbox', 'agents', 'saved', 'error', 'ended', 'missing', 'window', 'mobile', 'plugin'
];

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
    expect(html).toContain('class="pane-empty-art" aria-hidden="true"');
    expect(html).toContain('data-scene="ended"');
    expect(html).toContain('pane-empty-title');
    expect(html).toContain('Gone');
    expect(html).toContain('pane-empty-hint');
    expect(html).toContain('Close this pane.');
    expect(html).toContain('Retry');
  });

  it.each(ARTS)('renders the %s fairy scene', (art) => {
    const html = renderToStaticMarkup(<PaneEmptyState art={art} title="A" />);
    expect(html).toContain(`data-art="${art}"`);
    expect(html).toContain(`fairy-scene fairy-scene--${art}`);
    expect(html).toContain('class="fairy-art"');
    expect(html).not.toContain('lucide-');
    const gradient = /id="(fairy-wing-[^"]+)"/.exec(html)?.[1];
    expect(gradient).toBeTruthy();
    expect(html).toContain(`url(#${gradient})`);
  });

  it('announces only the loading arts as a status', () => {
    for (const art of ARTS) {
      const html = renderToStaticMarkup(<PaneEmptyState art={art} title="A" />);
      expect(html.includes('role="status"')).toBe(art === 'conversation' || art === 'first-turn' || art === 'plugin');
    }
  });

  it('omits the hint when none is passed', () => {
    const html = renderToStaticMarkup(<PaneEmptyState art="agents" title="No agents" />);
    expect(html).toContain('No agents');
    expect(html).not.toContain('pane-empty-hint');
  });

  it('gives each scene instance its own wing gradient', () => {
    const html = renderToStaticMarkup(
      <>
        <PaneEmptyState art="conversation" title="A" />
        <PaneEmptyState art="conversation" title="B" />
      </>
    );
    const ids = [...html.matchAll(/id="(fairy-wing-[^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('appends an extra className', () => {
    const html = renderToStaticMarkup(
      <PaneEmptyState art="missing" title="Missing" className="extra-slot" />
    );
    expect(html).toContain('class="pane-empty extra-slot"');
  });
});
