import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AppPageHeader } from '../AppPageHeader.js';

describe('AppPageHeader', () => {
  it('renders nothing when the row has no children and no actions', () => {
    expect(renderToStaticMarkup(<AppPageHeader />)).toBe('');
    expect(renderToStaticMarkup(<AppPageHeader actions={null}>{null}</AppPageHeader>)).toBe('');
    expect(renderToStaticMarkup(<AppPageHeader actions={false}>{false}</AppPageHeader>)).toBe('');
    expect(renderToStaticMarkup(<AppPageHeader>{'  '}</AppPageHeader>)).toBe('');
    expect(renderToStaticMarkup(<AppPageHeader>{[]}</AppPageHeader>)).toBe('');
  });

  it('treats primitive and array children as content', () => {
    expect(renderToStaticMarkup(<AppPageHeader>{3}</AppPageHeader>)).toContain('>3<');
    expect(renderToStaticMarkup(<AppPageHeader>Inbox</AppPageHeader>)).toContain('Inbox');
    expect(renderToStaticMarkup(<AppPageHeader>{['Go']}</AppPageHeader>)).toContain('Go');
  });

  it('provides a shared route chrome row with a top-left ownership marker', () => {
    const markup = renderToStaticMarkup(
      <AppPageHeader actions={<button type="button">Clear</button>} />
    );

    expect(markup).toContain('class="app-page-header app-page-header--top-left"');
    expect(markup).toContain('data-testid="app-page-header-content-row"');
    expect(markup).toContain('class="app-page-header-actions"');
    expect(markup).not.toContain('app-page-header-title');
  });

  it('renders optional leading children without a page title slot', () => {
    const markup = renderToStaticMarkup(
      <AppPageHeader className="list-header" ownsWindowTopLeft={false}>
        <button type="button" className="focus-back">All projects</button>
      </AppPageHeader>
    );

    expect(markup).toContain('class="app-page-header list-header"');
    expect(markup).not.toContain('app-page-header--top-left');
    expect(markup).toContain('focus-back');
    expect(markup).not.toContain('app-page-header-actions');
    expect(markup).not.toContain('app-page-header-title');
  });

  it('reserves the fixed trigger only for collapsed top-left headers', () => {
    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

    expect(css).toContain('.app-shell.sidebar-is-collapsed .app-page-header--top-left .app-page-header-content-row');
    expect(css).toContain('transition: padding-left 200ms linear;');
    expect(css).not.toContain('.app-page-header-title');
  });
});
