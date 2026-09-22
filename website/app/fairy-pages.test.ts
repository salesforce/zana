// @vitest-environment happy-dom
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/link', () => ({
  default: ({ children, ...props }: ComponentProps<'a'>) =>
    createElement('a', props, children)
}));
const route = vi.hoisted(() => ({ path: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.path }));
import Home from './page';
import Features from './features/page';
import Plugins from './extensions/page';
import { Nav, Footer } from './components/Nav';

beforeEach(() => {
  route.path = '/';
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  });
  document.documentElement.setAttribute('data-theme', 'dark');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Fairy page journeys', () => {
  it('provides a complete product story and working destinations without JavaScript', () => {
    const markup = renderToStaticMarkup(createElement(Home));
    const dom = new DOMParser().parseFromString(markup, 'text/html');
    expect(dom.querySelectorAll('h1')).toHaveLength(1);
    expect(dom.querySelector('h1')?.textContent).toContain('All together.');
    for (const id of [
      'hero-heading',
      'demo',
      'inbox-heading',
      'library-heading',
      'plugins-heading',
      'architecture-heading'
    ])
      expect(dom.getElementById(id)).not.toBeNull();
    for (const href of [
      '/download/',
      '#demo',
      '/features/',
      '/marketplace/',
      '/extensions/',
      '/docs/getting-started/',
      '/artwork/zana-architecture.svg'
    ])
      expect(dom.querySelector(`a[href="${href}"]`)).not.toBeNull();
    expect(markup).toContain(
      'Threads use signed host commands. CLI Agents retain the desktop launch path.'
    );
    expect(markup).toContain('Example workflow');
    expect(markup).toContain('Example finding');
    const metadata = JSON.parse(
      dom.querySelector('script[type="application/ld+json"]')!.textContent!
    );
    expect(metadata.operatingSystem).toBe('macOS');
    expect(metadata.offers.price).toBe('0');
  });
  it('offers separate paths to find and build plugins with an explicit trust explanation', () => {
    const markup = renderToStaticMarkup(createElement(Plugins));
    const dom = new DOMParser().parseFromString(markup, 'text/html');
    expect(dom.querySelector('a[href="/marketplace/"]')?.textContent).toContain(
      'Find a plugin'
    );
    expect(
      dom.querySelector('a[href="/extensions/getting-started/"]')?.textContent
    ).toContain('Build a plugin');
    expect(markup).toContain('Server code runs with full trust.');
    expect(
      dom.querySelector('a[href="/artwork/zana-plugins.svg"]')
    ).not.toBeNull();
    expect(dom.querySelector('#plugin-guide')).not.toBeNull();
  });
  it('preserves deep links to every product feature with audience-facing copy', () => {
    const markup = renderToStaticMarkup(createElement(Features));
    const dom = new DOMParser().parseFromString(markup, 'text/html');
    for (const id of [
      'tour-features',
      'kanban',
      'thread',
      'cli',
      'inbox',
      'plugins',
      'remote'
    ])
      expect(dom.getElementById(id)).not.toBeNull();
    expect(markup).not.toContain('fake UI');
    expect(markup).toContain('A clear view of the work.');
  });
});

describe('shared navigation', () => {
  it.each([
    '/features/',
    '/extensions/',
    '/marketplace/',
    '/dashboard/',
    '/docs/using-zana/'
  ])('marks the parent destination for %s', (path) => {
    route.path = path;
    render(createElement(Nav, { starCount: 1250 }));
    const current = document.querySelector('a[aria-current="page"]');
    expect(current?.textContent).toBe(
      path.startsWith('/features')
        ? 'Product'
        : path.startsWith('/docs')
          ? 'Docs'
          : 'Plugins'
    );
    expect(screen.getByLabelText(/Star on GitHub/)).toBeTruthy();
  });
  it('opens the mobile links, closes on navigation, and persists theme changes', () => {
    const { rerender } = render(createElement(Nav));
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(document.getElementById('mobile-menu')).not.toBeNull();
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Switch to light theme' })[0]
    );
    expect(localStorage.getItem('zcc-theme')).toBe('light');
    expect(
      screen.getAllByRole('button', { name: 'Switch to dark theme' })
    ).toHaveLength(2);
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Switch to dark theme' })[1]
    );
    expect(localStorage.getItem('zcc-theme')).toBe('dark');
    route.path = '/docs/';
    rerender(createElement(Nav));
    expect(document.getElementById('mobile-menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(document.getElementById('mobile-menu')).toBeNull();
  });
  it('can switch theme when browser storage is unavailable', () => {
    document.documentElement.removeAttribute('data-theme');
    render(createElement(Nav));
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Switch to light theme' })[0]
    );
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
  it('keeps publishing, marketplace and source links discoverable in the footer', () => {
    render(createElement(Footer));
    expect(
      screen.getByRole('link', { name: 'Publish' }).getAttribute('href')
    ).toBe('/dashboard/');
    expect(
      screen.getByRole('link', { name: 'Marketplace' }).getAttribute('href')
    ).toBe('/marketplace/');
    expect(
      screen.getByRole('link', { name: 'Source' }).getAttribute('href')
    ).toBe('https://github.com/salesforce/zana');
  });
});
