import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('ProjectFocusView session rows', () => {
  it('opens the shared agent lifecycle menu from a session row', () => {
    const source = readFileSync(new URL('./ProjectFocusView.tsx', import.meta.url), 'utf8');
    expect(source).toContain('onContextMenu={(e) => openAgentCardMenu(e, t)}');
    expect(source).toContain('useAgentCardActions()');
    expect(source).toContain('<AgentCardMenu');
  });
});
