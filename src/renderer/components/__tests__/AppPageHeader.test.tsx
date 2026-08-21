import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AppPageHeader } from '../AppPageHeader.js';

describe('AppPageHeader', () => {
  it('provides a shared route chrome row with a top-left ownership marker', () => {
    const markup = renderToStaticMarkup(
      <AppPageHeader title={<h1>Inbox</h1>} actions={<button type="button">Clear</button>} />
    );

    expect(markup).toContain('class="app-page-header app-page-header--top-left"');
    expect(markup).toContain('data-testid="app-page-header-content-row"');
    expect(markup).toContain('class="app-page-header-actions"');
  });

  it('reserves the fixed trigger only for collapsed top-left headers', () => {
    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

    expect(css).toContain('.app-shell.sidebar-is-collapsed .app-page-header--top-left .app-page-header-content-row');
    expect(css).toContain('transition: padding-left 200ms linear;');
  });
});
