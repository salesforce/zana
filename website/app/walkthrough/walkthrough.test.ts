// @vitest-environment jsdom
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseHelpVideos } from '../../lib/help-videos';
import catalogue from '../../content/videos/catalogue.json';
import { VideoChapters } from './VideoChapters';
import { walkthroughVideos } from './videos';
import WalkthroughPage, { metadata } from './page';
import sitemap from '../sitemap';
import { DOCS } from '../../lib/docs';
import { AgentConstellation } from './AgentConstellation';

vi.mock('next/link', () => ({ default: ({ children, ...props }: ComponentProps<'a'>) => createElement('a', props, children) }));
vi.mock('../../lib/help-videos', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/help-videos')>(),
  loadHelpVideos: vi.fn(async () => parseHelpVideos(catalogue))
}));
afterEach(cleanup);

const helpVideos = parseHelpVideos(catalogue);
const videos = walkthroughVideos(helpVideos);

describe('walkthrough chapters', () => {
  it('leads with the shipped overview and curates basics and app demos in a stable order', () => {
    expect(videos.map(video => video.id)).toEqual(['overview', 'guided-start', 'how-to-use-a-squad', 'zana-everywhere', 'build-an-agentforce-agent', 'agentforce-studio-tour']);
    expect(walkthroughVideos([...helpVideos].reverse())).toEqual(videos);
    for (const video of videos) {
      for (const asset of [video.src, video.poster, video.captions]) {
        if (asset.startsWith('/')) expect(existsSync(join(__dirname, '../../public', asset))).toBe(true);
        else expect(asset).toMatch(/^https:\/\/raw.githubusercontent.com\/salesforce\/zana\/main\/content\/videos\/media\//);
      }
    }
    expect(videos[1].silent).toBe(true);
    expect(videos[2].silent).toBe(false);
  });

  it('omits unavailable chapters and keeps the local overview without upstream videos', () => {
    expect(walkthroughVideos([]).map(video => video.id)).toEqual(['overview']);
    expect(walkthroughVideos([helpVideos[1]]).map(video => video.id)).toEqual(['overview', 'how-to-use-a-squad']);
  });
});

describe('video player', () => {
  it('starts with the overview ready, captions enabled, and no automatic download or playback', () => {
    render(createElement(VideoChapters, { videos }));
    const player = screen.getByLabelText(videos[0].title) as HTMLVideoElement;
    expect(player.controls).toBe(true);
    expect(player.playsInline).toBe(true);
    expect(player.autoplay).toBe(false);
    expect(player.preload).toBe('none');
    expect(player.crossOrigin).toBe('anonymous');
    expect(player.muted).toBe(false);
    expect(player.getAttribute('poster')).toBe(videos[0].poster);
    expect(player.querySelector('track')?.getAttribute('src')).toBe(videos[0].captions);
    expect(player.querySelector('track')?.hasAttribute('default')).toBe(true);
    expect(screen.getByRole('list', { name: 'Walkthrough videos' }).children).toHaveLength(6);
    expect(screen.getByRole('button', { name: /Meet Zana in 90 seconds/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('replaces the previous player, caption track, poster, and audio setting on chapter changes', () => {
    render(createElement(VideoChapters, { videos }));
    const overview = screen.getByLabelText(videos[0].title);
    fireEvent.click(screen.getByRole('button', { name: /Your first project in 30 seconds/ }));
    const firstProject = screen.getByLabelText(videos[1].title) as HTMLVideoElement;
    expect(overview.isConnected).toBe(false);
    expect(firstProject.getAttribute('src')).toBe(videos[1].src);
    expect(firstProject.getAttribute('poster')).toBe(videos[1].poster);
    expect(firstProject.querySelector('track')?.getAttribute('src')).toBe(videos[1].captions);
    expect(firstProject.muted).toBe(true);
    expect(screen.getByText(videos[1].details, { exact: false })).toBeTruthy();
    expect(screen.getByText(videos[1].description)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Meet Zana in 90 seconds/ }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /How to use a Squad/ }));
    expect((screen.getByLabelText(videos[2].title) as HTMLVideoElement).muted).toBe(false);
    expect(firstProject.isConnected).toBe(false);
  });

  it('recovers from media errors by retrying or choosing another chapter', () => {
    render(createElement(VideoChapters, { videos }));
    const firstPlayer = screen.getByLabelText(videos[0].title);
    fireEvent.error(firstPlayer);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'open the video directly' }).getAttribute('href')).toBe(videos[0].src);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(firstPlayer.isConnected).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.error(screen.getByLabelText(videos[0].title));
    fireEvent.click(screen.getByRole('button', { name: /How to use a Squad/ }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falls back if the selected chapter disappears and keeps a useful empty state', () => {
    const { rerender } = render(createElement(VideoChapters, { videos }));
    fireEvent.click(screen.getByRole('button', { name: /How to use a Squad/ }));
    rerender(createElement(VideoChapters, { videos: [videos[0]] }));
    expect(screen.getByLabelText(videos[0].title)).toBeTruthy();
    rerender(createElement(VideoChapters, { videos: [] }));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('link', { name: /getting started guide/ }).getAttribute('href')).toBe('/docs/getting-started/');
  });
});

describe('agent constellation', () => {
  it('connects the complete agent and tool groups with accessible, useful destinations', () => {
    render(createElement(AgentConstellation));
    expect(screen.getByRole('heading', { name: 'Zana consolidates them into one workspace.' })).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Agents and tools in one place' });
    expect(list.children).toHaveLength(8);
    for (const name of ['Claude Code', 'Codex', 'Cursor', 'OpenCode', 'Grok Build', 'Agentforce Code', 'Pi · Mastra · ACP', 'Slack · GUS · GitHub']) {
      expect(screen.getByRole('link', { name: new RegExp(name.replaceAll(' · ', '.*')) }).getAttribute('href')).toMatch(/^\/(docs\/getting-started|marketplace)\/$/);
    }
    const region = screen.getByRole('region', { name: 'Zana consolidates them into one workspace.' });
    expect(region.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    const hubLogo = region.querySelector('figure > div img') as HTMLImageElement;
    const hubLogoUrl = new URL(hubLogo.src, 'https://example.test');
    expect(hubLogoUrl.searchParams.get('url') ?? hubLogoUrl.pathname).toBe('/zana-icon-512.png');
    expect(region.querySelectorAll('svg line')).toHaveLength(8);
    const connections = Array.from(region.querySelectorAll('svg line')).map(line => line.getAttribute('data-connection')).sort();
    expect(connections).toEqual(Array.from(list.children).map(node => node.getAttribute('data-node')).sort());
    for (const img of region.querySelectorAll('img')) {
      const url = new URL(img.src, 'https://example.test');
      expect(existsSync(join(__dirname, '../../public', url.searchParams.get('url') ?? url.pathname))).toBe(true);
      expect(img.alt).toBe('');
    }
  });
});

describe('walkthrough page', () => {
  it('explains the product, setup, and strengths with working journeys and crawlable metadata', async () => {
    const markup = renderToStaticMarkup(await WalkthroughPage());
    const doc = new DOMParser().parseFromString(markup, 'text/html');
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
    expect(doc.querySelector('h1')?.textContent).toBe('Every agent. One workspace.');
    expect(markup).toContain('one desktop app');
    expect(doc.querySelector('#one-workspace')).toBeTruthy();
    expect(Array.from(doc.querySelectorAll('th')).map(cell => [cell.textContent, cell.getAttribute('scope')])).toEqual([['Today', 'col'], ['With Zana', 'col']]);
    expect(doc.querySelector('table caption')?.textContent).toContain('compared with using Zana');
    expect(doc.querySelectorAll('tbody tr')).toHaveLength(4);
    expect(doc.querySelector('tbody')?.textContent).toContain('reports delivered to your Inbox');
    expect(doc.querySelector('[aria-label="Start using Zana"]')?.children).toHaveLength(3);
    expect(doc.querySelector('[aria-label="Squad workflow"]')?.textContent).toBe('PlanBuildReview');
    expect(doc.querySelectorAll('article')).toHaveLength(4);
    expect(doc.querySelector('#shared-tools')?.textContent).toContain('Built once');
    expect(doc.querySelector('#next-heading')?.textContent).toBe('Every agent. One place.');
    const productShots = Array.from(doc.querySelectorAll('img')).filter(img => img.alt.startsWith('Zana '));
    for (const img of productShots) {
      const optimized = new URL(img.src, 'https://example.test');
      const source = optimized.searchParams.get('url') ?? optimized.pathname;
      expect(existsSync(join(__dirname, '../../public', source))).toBe(true);
      expect(img.getAttribute('alt')?.length).toBeGreaterThan(30);
    }
    expect(productShots).toHaveLength(2);
    for (const link of doc.querySelectorAll('a[href^="#"]')) expect(doc.querySelector(link.getAttribute('href')!)).toBeTruthy();
    for (const link of doc.querySelectorAll('a[href^="/docs/"]')) {
      const slug = link.getAttribute('href')!.split('/')[2];
      expect(DOCS.some(entry => entry.slug === slug)).toBe(true);
    }
    for (const href of ['/download/', '/features/', '/marketplace/']) expect(doc.querySelector(`a[href="${href}"]`)).toBeTruthy();
    expect(metadata.alternates?.canonical).toBe('/walkthrough/');
    expect(metadata.openGraph?.url).toBe('/walkthrough/');
    expect(sitemap().some(entry => entry.url.endsWith('/walkthrough/'))).toBe(true);
  });
});
