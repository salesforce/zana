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
  it('opens on the Modern step and names CLI Agent as still available', () => {
    const html = renderToStaticMarkup(<Walkthrough onClose={() => undefined} />);
    expect(html).toContain('data-walkthrough-step="thread"');
    expect(html).toContain('Start a conversation');
    expect(html).toContain('New Chat');
    expect(html).toContain('Modern');
    expect(html).toContain('conversation');
    expect(html).not.toContain('conversation thread');
    expect(html).toContain('Step 1 of 4');
    expect(html).toContain('walkthrough-backdrop--composer');
    expect(html).not.toContain('Quick Agent');
    expect(html).not.toContain('Launch an agent');
    expect(html).not.toContain('Legacy Agent');
  });

  it('keeps the four-step tour in source: Modern, CLI Agent, project, schedule', () => {
    const source = readFileSync(new URL('./Walkthrough.tsx', import.meta.url), 'utf8');
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
