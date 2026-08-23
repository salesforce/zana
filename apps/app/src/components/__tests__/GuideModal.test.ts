import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * GuideModal mounts inside Home's `.aurora-host` (isolation: isolate) while
 * the sidebar uses z-index: 1. Without a body portal the dialog paints under
 * the rail. No jsdom here — pin the portal the same way AgentLauncher does.
 */
describe('GuideModal overlay stacking', () => {
  it('portals the palette backdrop to document.body', () => {
    const source = readFileSync(new URL('../GuideModal.tsx', import.meta.url), 'utf8');
    expect(source).toContain('return createPortal(');
    expect(source).toContain('className="palette-backdrop"');
    expect(source).toContain('document.body');
  });
});
