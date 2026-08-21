import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('ProjectAgentsBoard launcher routing', () => {
  it('renders the project launcher inline after all board hooks', () => {
    const source = readFileSync(new URL('./ProjectAgentsView.tsx', import.meta.url), 'utf8');
    const inlineBranch = source.indexOf('if (launcherOpen) {');
    const lastHook = source.lastIndexOf('const pick = (c: AgentCard) =>');

    expect(inlineBranch).toBeGreaterThan(lastHook);
    expect(source.slice(inlineBranch)).toContain('presentation="inline"');
    expect(source.slice(inlineBranch)).toContain('backgroundTabs={backgroundTerminals(sessions)}');
  });
});
