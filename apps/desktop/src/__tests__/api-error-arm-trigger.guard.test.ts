/**
 * Source-text guard for the API-error arm trigger in host.ts: producers without a turn-start hook are armed
 * from the output-activity busy edge, derived from the adapter's own status (a producer and no interaction
 * hook), never from a harness id (rule 6).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(__dirname, '..', 'host.ts'), 'utf8');
const start = source.indexOf('const outputActivity = new OutputActivityMonitor');
const block = source.slice(start, source.indexOf('/**', start));
const dispatcher = readFileSync(join(__dirname, '..', 'api-error-dispatch.ts'), 'utf8');
const trigger = dispatcher.slice(dispatcher.indexOf('export function armOnBusyEdge'));

describe('API-error busy-edge arm trigger', () => {
  it('exists and arms through the shared dispatcher', () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toMatch(/onBusyEdge:/);
    expect(block).toMatch(/armOnBusyEdge\(\s*apiErrorDispatchCtx/);
  });

  it('is gated on the adapter shape, not a harness id', () => {
    expect(trigger).toMatch(/!status\?\.apiErrorProducer \|\| status\.interactionHook/);
    expect(block).not.toMatch(/['"`](claude|codex|opencode|pi|cursor|grok)['"`]/);
    expect(block).not.toMatch(/session\.profile\s*[!=]==/);
  });

  it('does not re-arm a session that is already armed, and skips exited sessions', () => {
    expect(trigger).toMatch(/isArmed\(sessionId\)/);
    expect(trigger).toMatch(/session\.status === 'exited'/);
  });
});
