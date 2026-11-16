/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ZanaFairy } from './ZanaFairy.js';
import { FairyEmpty, ZanaSpinner } from './ZanaSpinner.js';
import { FairyScene } from './FairyScenes.js';

describe('ZanaFairy', () => {
  it('is decorative and defaults to the flying mood', () => {
    const html = renderToStaticMarkup(<ZanaFairy />);
    expect(html).toContain('class="fairy fairy--flying"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('fairy-wing--left');
    expect(html).toContain('fairy-wing--right');
    expect(html).toContain('class="fairy-star"');
  });

  it('applies the mood and an extra class', () => {
    expect(renderToStaticMarkup(<ZanaFairy mood="resting" className="x" />)).toContain('class="fairy fairy--resting x"');
    expect(renderToStaticMarkup(<ZanaFairy mood="still" />)).toContain('class="fairy fairy--still"');
  });
});

describe('ZanaSpinner', () => {
  it('draws four wings around a gold centre and stays decorative by default', () => {
    const html = renderToStaticMarkup(<ZanaSpinner />);
    expect(html.match(/<path /g)).toHaveLength(4);
    expect(html).toContain('<circle r="5"');
    expect(html).toContain('width="16"');
    expect(html).toContain('class="fairy-spinner"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="img"');
  });

  it('accepts size, className and a test id like Loader2', () => {
    const html = renderToStaticMarkup(<ZanaSpinner size={12} className="spin" data-testid="busy" />);
    expect(html).toContain('width="12"');
    expect(html).toContain('height="12"');
    expect(html).toContain('class="fairy-spinner spin"');
    expect(html).toContain('data-testid="busy"');
  });

  it('becomes a labelled image when given an aria-label', () => {
    const html = renderToStaticMarkup(<ZanaSpinner aria-label="working" />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="working"');
    expect(html).not.toContain('aria-hidden');
  });

  it('honours an explicit aria-hidden value', () => {
    expect(renderToStaticMarkup(<ZanaSpinner aria-hidden="false" />)).toContain('aria-hidden="false"');
  });
});

describe('FairyEmpty', () => {
  it('renders a still fairy with a title and optional hint', () => {
    const html = renderToStaticMarkup(<FairyEmpty title="No matches" hint="Try again." className="x" />);
    expect(html).toContain('class="fairy-empty x"');
    expect(html).toContain('fairy--still');
    expect(html).toContain('<span class="fairy-empty-title">No matches</span>');
    expect(html).toContain('<span class="fairy-empty-hint">Try again.</span>');
    const bare = renderToStaticMarkup(<FairyEmpty title="Nothing"><b>extra</b></FairyEmpty>);
    expect(bare).toContain('class="fairy-empty"');
    expect(bare).not.toContain('fairy-empty-hint');
    expect(bare).toContain('<b>extra</b>');
  });
});

describe('FairyScene', () => {
  it('builds the scene pieces each story needs', () => {
    expect(renderToStaticMarkup(<FairyScene kind="conversation" />).match(/class="fairy-bubble[ "]/g)).toHaveLength(4);
    expect(renderToStaticMarkup(<FairyScene kind="first-turn" />)).toContain('fairy-first-agent');
    expect(renderToStaticMarkup(<FairyScene kind="inbox" />)).toContain('fairy-inbox-badge');
    expect(renderToStaticMarkup(<FairyScene kind="agents" />)).toContain('fairy-agents-live');
    expect(renderToStaticMarkup(<FairyScene kind="saved" />)).toContain('fairy-saved-ribbon');
    expect(renderToStaticMarkup(<FairyScene kind="error" />).match(/fairy-error-puff/g)).toHaveLength(4);
    expect(renderToStaticMarkup(<FairyScene kind="ended" />)).toContain('fairy--resting');
    expect(renderToStaticMarkup(<FairyScene kind="missing" />)).toContain('fairy-missing-beam');
    expect(renderToStaticMarkup(<FairyScene kind="window" />).match(/fairy-window-dust/g)).toHaveLength(4);
    expect(renderToStaticMarkup(<FairyScene kind="mobile" />)).toContain('fairy-mobile-laptop');
    expect(renderToStaticMarkup(<FairyScene kind="plugin" />).match(/fairy-plugin-tile/g)).toHaveLength(4);
  });

});
