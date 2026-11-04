// @vitest-environment happy-dom
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({ default: ({ children, ...props }: ComponentProps<'a'>) => createElement('a', props, children) }));
vi.mock('./DocsSidebar', () => ({ DocsSidebar: () => null }));
vi.mock('./DocsSearch', () => ({ DocsSearch: () => null }));
vi.mock('./DocsEnhancer', () => ({ DocsEnhancer: () => null }));
vi.mock('./GettingStarted', () => ({ GettingStarted: () => createElement('article', {}, 'Video-led onboarding') }));
vi.mock('../../lib/search-index', () => ({ buildSearchIndex: vi.fn().mockResolvedValue([]) }));
vi.mock('../../lib/docs', () => ({ getDocSiblings: vi.fn() }));
vi.mock('../../lib/help-videos', () => ({ loadHelpVideos: vi.fn().mockResolvedValue([]) }));
import { DocLayout } from './DocLayout';
import { getDocSiblings } from '../../lib/docs';
import { loadHelpVideos } from '../../lib/help-videos';

beforeEach(() => { vi.clearAllMocks(); vi.mocked(getDocSiblings).mockReturnValue({ prev: undefined, next: undefined }); });
const meta = (slug: string) => ({ slug, title: 'Guide', group: 'Start' });
const toc = [{ id: 'one', text: 'One', level: 2 as const }, { id: 'two', text: 'Two', level: 3 as const }];

it('uses video onboarding at both documentation entry points without the old article or TOC', async () => {
  const markup = renderToStaticMarkup(await DocLayout({ meta: meta('getting-started'), html: '<p>Old long article</p>', toc }));
  expect(loadHelpVideos).toHaveBeenCalledOnce();
  expect(markup).toContain('Video-led onboarding');
  expect(markup).toContain('docs-shell-videos');
  expect(markup).not.toContain('Old long article');
  expect(markup).not.toContain('On this page');
  expect(markup).not.toContain('Suggested next step');
});

it.each(['using-zana', 'extensions-quickstart', 'extensions-authoring', 'extensions-sdk-reference'])('preserves the full guide and next step for %s', async slug => {
  const markup = renderToStaticMarkup(await DocLayout({ meta: meta(slug), html: '<h1>Written guide</h1>', toc }));
  expect(loadHelpVideos).not.toHaveBeenCalled();
  expect(markup).toContain('Written guide');
  expect(markup).toContain('Suggested next step');
  expect(markup).toContain('On this page');
  expect(markup).toContain('class="h3"');
  expect(markup).not.toContain('docs-shell-videos');
});

it.each([
  { prev: meta('prev'), next: meta('next') },
  { prev: undefined, next: meta('next') },
  { prev: meta('prev'), next: undefined }
])('preserves pagination with missing siblings %#', async siblings => {
  vi.mocked(getDocSiblings).mockReturnValue(siblings);
  const markup = renderToStaticMarkup(await DocLayout({ meta: meta('cli'), html: '<h1>CLI</h1>', toc: [] }));
  expect(markup).toContain('Pagination');
  expect(markup.includes('← Previous')).toBe(Boolean(siblings.prev));
  expect(markup.includes('Next →')).toBe(Boolean(siblings.next));
  expect(markup).not.toContain('Suggested next step');
});
