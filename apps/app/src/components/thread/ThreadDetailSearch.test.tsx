import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThreadDetailSearch, threadDetailSearchClassName } from './ThreadDetailSearch.js';

describe('threadDetailSearchClassName', () => {
  it('stays collapsed until the draft has a query', () => {
    expect(threadDetailSearchClassName('')).toBe('thread-detail-search');
    expect(threadDetailSearchClassName('   ')).toBe('thread-detail-search');
    expect(threadDetailSearchClassName('codin')).toBe('thread-detail-search has-query');
  });
});

describe('ThreadDetailSearch', () => {
  it('renders an icon toggle and keeps the field available', () => {
    const html = renderToStaticMarkup(
      <ThreadDetailSearch value="" onChange={() => undefined} onSubmit={() => undefined} />
    );
    expect(html).toContain('data-testid="thread-detail-search"');
    expect(html).toContain('class="thread-detail-search"');
    expect(html).not.toContain('has-query');
    expect(html).toContain('aria-label="Search in thread"');
    expect(html).toContain('placeholder="Search"');
    expect(html).toContain('thread-detail-search-toggle');
  });

  it('keeps the field expanded while a query is present', () => {
    const html = renderToStaticMarkup(
      <ThreadDetailSearch value="hello" onChange={() => undefined} onSubmit={() => undefined} />
    );
    expect(html).toContain('thread-detail-search has-query');
    expect(html).toContain('value="hello"');
  });

  it('focuses the field from the icon and clears on Escape', () => {
    const source = readFileSync(new URL('./ThreadDetailSearch.tsx', import.meta.url), 'utf8');
    expect(source).toContain('inputRef.current?.focus()');
    expect(source).toContain("if (event.key !== 'Escape') return");
    expect(source).toContain("onChange('')");
    expect(source).toContain("onSubmit('')");
    expect(source).toContain('event.currentTarget.blur()');
  });
});
