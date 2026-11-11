// @vitest-environment happy-dom
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/link', () => ({
  default: ({ children, ...props }: ComponentProps<'a'>) => createElement('a', props, children)
}));
import GettingStarted from './getting-started/page';
import Install from './install/page';
import Sdk from './sdk/page';
import { Icon, NextCard, ProofCard, SectionHead } from './blocks';

describe('plugin documentation pages', () => {
  it('renders the getting-started flow with its steps, prerequisites and next card', () => {
    const markup = renderToStaticMarkup(createElement(GettingStarted));
    expect(markup).toContain('<h1');
    expect(markup).toContain('/zana-icon-512.png');
    expect(markup).toMatch(/<ol[^>]*>/);
    expect(markup).toContain('href="/extensions/');
  });

  it('renders every install route and the shared trust confirmation', () => {
    const markup = renderToStaticMarkup(createElement(Install));
    expect(markup).toContain('<h1');
    expect(markup.match(/<svg/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(markup).toContain('/zana-icon-512.png');
  });

  it('renders the four SDK layers in order', () => {
    const markup = renderToStaticMarkup(createElement(Sdk));
    for (const n of ['01', '02', '03', '04']) expect(markup).toContain(`>${n}<`);
    expect(markup).toContain('Server API');
    expect(markup.indexOf('Server API')).toBeGreaterThan(markup.indexOf('01'));
  });
});

describe('plugin page blocks', () => {
  it('renders a section heading with and without a lede', () => {
    expect(renderToStaticMarkup(createElement(SectionHead, { eyebrow: 'E', lede: 'Lede text' }, 'Title'))).toContain('Lede text');
    const bare = renderToStaticMarkup(createElement(SectionHead, { eyebrow: 'E' }, 'Title'));
    expect(bare).toContain('Title');
    expect(bare).not.toContain('Lede text');
  });

  it('renders a proof card with link and checklist, and without either', () => {
    const full = renderToStaticMarkup(createElement(ProofCard, {
      eyebrow: 'Trust', title: 'Full trust', body: 'Body', icon: 'key',
      items: ['First check', 'Second check'], link: { href: '/docs/', label: 'Read more' }
    }));
    expect(full).toContain('href="/docs/"');
    expect(full).toContain('Second check');
    expect(full).toContain('<ul');
    const bare = renderToStaticMarkup(createElement(ProofCard, { eyebrow: 'Trust', title: 'Bare', body: 'Body' }));
    expect(bare).not.toContain('<ul');
    expect(bare).not.toContain('<a ');
  });

  it('renders a next card and icons at default and custom sizes', () => {
    const next = renderToStaticMarkup(createElement(NextCard, { eyebrow: 'Next', title: 'Go', body: 'Body', actions: createElement('a', { href: '/x/' }, 'Act') }));
    expect(next).toContain('href="/x/"');
    expect(renderToStaticMarkup(createElement(Icon, { name: 'check' }))).toContain('width="22"');
    expect(renderToStaticMarkup(createElement(Icon, { name: 'check', size: 13 }))).toContain('width="13"');
  });
});
