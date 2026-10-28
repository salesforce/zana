import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';

const h = vi.hoisted(() => {
  const state = {
    setNav: vi.fn(),
    setWalkthroughHomeMode: vi.fn()
  };
  return { state };
});

vi.mock('../store.js', () => ({
  useUi: Object.assign((selector: (state: typeof h.state) => unknown) => selector(h.state), {
    getState: () => h.state
  })
}));

import { Walkthrough } from './Walkthrough.js';

describe('Walkthrough', () => {
  it('opens on the intro video in a wide card, in place of the step icon', () => {
    const html = renderToStaticMarkup(<Walkthrough onClose={() => undefined} />);
    expect(html).toContain('data-walkthrough-step="intro"');
    expect(html).toContain('Your first project in 30 seconds');
    expect(html).toContain('walkthrough-card--media');
    expect(html).toContain('data-testid="walkthrough-intro-video"');
    expect(html).not.toContain('walkthrough-icon');
    expect(html).toContain('Step 1 of 5');
    expect(html).toContain('A <strong>project</strong> is just a folder');
    expect(html).not.toContain('walkthrough-backdrop--composer');
  });

  it('keeps the tour in source: intro, Modern, CLI Agent, project, schedule', () => {
    const source = readFileSync(new URL('./Walkthrough.tsx', import.meta.url), 'utf8');
    expect(source).toContain("id: 'intro'");
    expect(source).toContain("id: 'thread'");
    expect(source).toContain("id: 'legacy'");
    expect(source).toContain("title: 'CLI Agent still works'");
    expect(source).toContain('Flip to <strong>CLI Agent</strong>');
    expect(source).toContain("id: 'project'");
    expect(source).toContain("id: 'schedule'");
    expect(source).toContain('walkthroughShellFor');
    expect(source).toContain('setWalkthroughHomeMode');
    expect(source).not.toContain("setNav('agents')");
  });

  it('clears the New Chat switcher when the tour closes, and Settings copy matches', () => {
    const store = readFileSync(new URL('../store.ts', import.meta.url), 'utf8');
    expect(store).toContain('walkthroughHomeMode: null');
    expect(store).toContain('setWalkthroughHomeMode');
    expect(store).toContain('{ walkthroughOpen, walkthroughHomeMode: null }');
    const settings = readFileSync(new URL('../views/settings/GlobalView.tsx', import.meta.url), 'utf8');
    expect(settings).toContain('starting a conversation, the CLI Agent composer');
    expect(settings).not.toContain('launching an agent, adding a project, and creating a schedule');
  });
});
