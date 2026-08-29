import { describe, it, expect } from 'vitest';
import { isRestfulAgentState } from '../types.js';

describe('isRestfulAgentState', () => {
  it('is true for idle, done, and waiting', () => {
    expect(isRestfulAgentState('idle')).toBe(true);
    expect(isRestfulAgentState('done')).toBe(true);
    expect(isRestfulAgentState('waiting')).toBe(true);
  });

  it('is false for working, blocked, and unknown', () => {
    expect(isRestfulAgentState('working')).toBe(false);
    expect(isRestfulAgentState('blocked')).toBe(false);
    expect(isRestfulAgentState('unknown')).toBe(false);
  });
});
