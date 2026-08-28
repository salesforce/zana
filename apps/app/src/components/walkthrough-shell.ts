export const WALKTHROUGH_STEP_IDS = ['thread', 'legacy', 'project', 'schedule'] as const;

export type WalkthroughStepId = (typeof WALKTHROUGH_STEP_IDS)[number];
export type WalkthroughHomeMode = 'thread' | 'agent';

/**
 * Each walkthrough step moves the shell to the real surface it describes.
 * Modern + CLI Agent both live on New Chat (`nav === 'home'`); the home
 * composer switcher follows `homeMode` so the tour can show each one.
 */
export function walkthroughShellFor(stepId: WalkthroughStepId): {
  nav: 'home' | 'scheduler';
  homeMode: WalkthroughHomeMode | null;
} {
  if (stepId === 'thread') return { nav: 'home', homeMode: 'thread' };
  if (stepId === 'legacy') return { nav: 'home', homeMode: 'agent' };
  if (stepId === 'project') return { nav: 'home', homeMode: null };
  return { nav: 'scheduler', homeMode: null };
}
