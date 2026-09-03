import { describe, expect, it } from 'vitest';
import { WALKTHROUGH_STEP_IDS, walkthroughShellFor } from './walkthrough-shell.js';

describe('walkthroughShellFor', () => {
  it('opens New Chat on Thread so the BB-style composer is on screen', () => {
    expect(walkthroughShellFor('thread')).toEqual({ nav: 'home', homeMode: 'thread' });
  });

  it('stays on New Chat and flips to CLI Agent', () => {
    expect(walkthroughShellFor('legacy')).toEqual({ nav: 'home', homeMode: 'agent' });
  });

  it('keeps New Chat visible while pointing at Projects, then Scheduler', () => {
    expect(walkthroughShellFor('project')).toEqual({ nav: 'home', homeMode: null });
    expect(walkthroughShellFor('schedule')).toEqual({ nav: 'scheduler', homeMode: null });
  });

  it('tours Modern and CLI Agent before project and schedule', () => {
    expect(WALKTHROUGH_STEP_IDS).toEqual(['thread', 'legacy', 'project', 'schedule']);
  });
});
