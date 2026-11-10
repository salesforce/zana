// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import MediaPressPage, { metadata } from './page';
import { PresentationPlayer } from './PresentationPlayer';
import sitemap from '../sitemap';

afterEach(cleanup);
const publicDir = join(__dirname, '../../public');

describe('Media & Press', () => {
  it('offers a light preview until requested, then loads and focuses the original presentation', () => {
    render(createElement(PresentationPlayer));
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('img').getAttribute('src')).toContain('zana-cover.webp');
    fireEvent.click(screen.getByRole('button', { name: 'Play the Zana presentation' }));
    const frame = screen.getByTitle('Zana — One workspace for every AI agent — presentation');
    expect(frame.getAttribute('src')).toBe('/media/presentations/zana.html#1');
    expect(frame.hasAttribute('allowfullscreen')).toBe(true);
    const focus = vi.spyOn(frame, 'focus');
    fireEvent.load(frame);
    expect(focus).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps the presentation, offline downloads, brand asset and product journeys available without JavaScript', () => {
    const markup = renderToStaticMarkup(createElement(MediaPressPage));
    const doc = new DOMParser().parseFromString(markup, 'text/html');
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
    expect(doc.querySelector('h1')?.textContent).toBe('Media & Press');
    expect(doc.querySelector('article[aria-labelledby="presentation-heading"] h2')?.textContent).toBe('One workspace for every AI agent.');
    const launch = doc.querySelector('a[href$="zana.html#1"]');
    expect(launch?.textContent).toContain('Open presentation');
    expect(launch?.getAttribute('rel')).toContain('noopener');
    const downloads = [...doc.querySelectorAll('a[download]')];
    expect(downloads.map(link => link.getAttribute('href'))).toEqual(['/media/presentations/zana.pdf', '/media/presentations/zana.html', '/zana-mark.svg']);
    for (const link of downloads) expect(existsSync(join(publicDir, link.getAttribute('href')!))).toBe(true);
    expect(doc.querySelector('a[href="/docs/getting-started/"]')).toBeTruthy();
    expect(doc.querySelector('a[href="https://github.com/salesforce/zana"]')).toBeTruthy();
    expect(metadata.alternates?.canonical).toBe('/media-press/');
    expect(metadata.openGraph?.url).toBe('/media-press/');
    expect(sitemap().some(entry => entry.url.endsWith('/media-press/'))).toBe(true);
  });

  it('ships all 16 original HTML slides and embedded imagery for offline use, plus a real PDF', () => {
    const html = readFileSync(join(publicDir, 'media/presentations/zana.html'), 'utf8');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('section.slide')).toHaveLength(16);
    expect(doc.querySelector('h1')?.textContent).toBe('Oneworkspacefor everyAI agent.');
    expect([...doc.querySelectorAll('section.slide h2')].some(el => el.textContent?.includes('AI Expert Suite'))).toBe(true);
    for (const img of doc.querySelectorAll('img')) expect(img.getAttribute('src')).toMatch(/^data:image\//);
    expect(doc.querySelector('button[aria-label="Next slide"]')).toBeTruthy();
    expect(doc.querySelector('button[aria-label="Previous slide"]')).toBeTruthy();
    expect(html).toContain("['ArrowRight','PageDown',' ','Enter']");
    expect(readFileSync(join(publicDir, 'media/presentations/zana.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
