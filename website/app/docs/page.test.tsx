// @vitest-environment happy-dom
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: ComponentProps<'a'>) => createElement('a', props, children)
}));
vi.mock('../../lib/docs', () => ({
  DOCS: [{ slug: 'getting-started', title: 'Getting started' }],
  renderDoc: async () => ({ html: '<p>Getting started content</p>', toc: [] })
}));
vi.mock('./DocLayout', () => ({ DocLayout: () => null }));
import DocsIndex from './page';

describe('documentation entry points', () => {
  it('makes the relocated architecture reachable alongside the task guides', async () => {
    const markup = renderToStaticMarkup(await DocsIndex());
    const dom = new DOMParser().parseFromString(markup, 'text/html');
    expect(dom.querySelector('a[href="/docs/architecture/"]')?.textContent).toContain('Explore the architecture');
    for (const href of ['/docs/getting-started/', '/docs/using-zana/', '/docs/multiple-devices/', '/extensions/']) {
      expect(dom.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
    expect(dom.querySelector('h1')?.textContent).toContain('Start with the task.');
  });
});
