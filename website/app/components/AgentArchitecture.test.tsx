// @vitest-environment happy-dom
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/link', () => ({
  default: ({ children, ...props }: ComponentProps<'a'>) => createElement('a', props, children)
}));
import { AgentArchitecture, PLUGIN_VIDEO } from './AgentArchitecture';
import Home from '../page';

describe('homepage agent architecture', () => {
  it('explains the platform above the agents with accessible text and useful destinations without JavaScript', () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(createElement(AgentArchitecture)), 'text/html');
    const section = doc.querySelector('section')!;
    expect(doc.getElementById(section.getAttribute('aria-labelledby')!)?.textContent).toBe('A layer above every agent.');
    expect([...doc.querySelectorAll('article h3 a')].map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Built in', '/features/'], ['Plugin SDK', '/extensions/sdk/'], ['Marketplace', '/marketplace/']
    ]);
    for (const article of doc.querySelectorAll('article')) {
      expect(article.querySelectorAll('li').length).toBeGreaterThanOrEqual(5);
      expect(article.querySelectorAll('img[alt=""]')).toHaveLength(1);
    }
    const agents = doc.querySelector('ul[aria-label="Agents supported by the Zana platform"]')!;
    expect(agents.children).toHaveLength(8);
    expect(agents.textContent).toContain('Agentforce Code');
    expect(agents.textContent).toContain('Any ACP agent');
    expect(section.textContent).toContain('Switching vendors keeps everything.');
    expect(doc.querySelector('a[href="/docs/architecture/"]')).not.toBeNull();
    expect(doc.querySelector('a[href="/media-press/"]')).not.toBeNull();
    expect(doc.querySelector('iframe,script')).toBeNull();
    for (const img of doc.querySelectorAll('img')) {
      const svg = readFileSync(join(__dirname, '../../public', img.getAttribute('src')!), 'utf8');
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg).not.toMatch(/<script|https?:\/\/(?!www\.w3\.org)/);
    }
  });

  it('shows the plugins video with captions, a poster, and no automatic download', () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(createElement(AgentArchitecture)), 'text/html');
    const video = doc.querySelector('figure video')!;
    expect(video.getAttribute('aria-label')).toMatch(/Built from plugins/);
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.hasAttribute('autoplay')).toBe(false);
    expect(video.getAttribute('preload')).toBe('none');
    expect(video.getAttribute('poster')).toBe(PLUGIN_VIDEO.poster);
    expect(video.querySelector('source')?.getAttribute('src')).toBe(PLUGIN_VIDEO.src);
    expect(video.querySelector('track[kind="captions"]')?.getAttribute('src')).toBe(PLUGIN_VIDEO.captions);
    for (const asset of Object.values(PLUGIN_VIDEO)) expect(existsSync(join(__dirname, '../../public', asset))).toBe(true);
    expect(doc.querySelector('figcaption a')?.getAttribute('href')).toBe('/extensions/getting-started/');
  });

  it('places the architecture between the tour and the plugin section on the main page', () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(createElement(Home)), 'text/html');
    const sections = [...doc.querySelector('.fairy-home')!.children];
    const index = sections.findIndex(section => section.id === 'agent-architecture');
    expect(index).toBeGreaterThan(0);
    expect(sections[index - 1].id).toBe('demo');
    expect(sections[index + 1].getAttribute('aria-labelledby')).toBe('plugins-heading');
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
  });
});
