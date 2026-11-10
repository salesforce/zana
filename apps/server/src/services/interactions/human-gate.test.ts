import { describe, expect, it } from 'vitest';
import { humanGateRefusal, NATIVE_SHEET_REQUIRED } from './human-gate.js';

const context = { title: 'Merge?', pluginId: 'p' };

describe('humanGateRefusal', () => {
  it('allows anything when no human is required', () => {
    expect(humanGateRefusal(undefined, 'agent', undefined, context)).toBeNull();
    expect(humanGateRefusal(false, 'unknown', undefined, context)).toBeNull();
  });
  it('requires a human actor for true, from the window or a sheet', () => {
    for (const actor of ['cli', 'agent', 'unknown'] as const) {
      expect(humanGateRefusal(true, actor, undefined, context)?.code).toBe('human-proof-required');
    }
    expect(humanGateRefusal(true, 'human', 'window', context)).toBeNull();
    expect(humanGateRefusal(true, 'human', 'sheet', context)).toBeNull();
  });
  it('requires the main-drawn sheet for native-sheet and says what to show', () => {
    expect(humanGateRefusal('native-sheet', 'cli', undefined, context)?.code).toBe('human-proof-required');
    expect(humanGateRefusal('native-sheet', 'human', undefined, context)?.code).toBe(NATIVE_SHEET_REQUIRED);
    const windowOnly = humanGateRefusal('native-sheet', 'human', 'window', context);
    expect(windowOnly).toMatchObject({ status: 403, code: NATIVE_SHEET_REQUIRED, details: { title: 'Merge?', pluginId: 'p' } });
    expect(humanGateRefusal('native-sheet', 'human', 'sheet', context)).toBeNull();
  });
});
