/**
 * Agent-state helper tests. `decayUnreliableAgentState` is the DISPLAY-only
 * transform that neutralizes a headless remote worker's unreliable at-rest
 * guesses to `unknown`; it must leave genuinely-known states (`working`,
 * `blocked`) and every state of a reliable-channel session untouched.
 */

import { describe, it, expect } from 'vitest';
import type { AgentState } from './product.js';
import { decayUnreliableAgentState, isRestfulAgentState } from './product.js';

const ALL_STATES: AgentState[] = ['working', 'blocked', 'done', 'idle', 'unknown', 'waiting'];

describe('decayUnreliableAgentState', () => {
  it('is a no-op for a reliable channel (every state passes through)', () => {
    for (const state of ALL_STATES) {
      expect(decayUnreliableAgentState(state, false)).toBe(state);
    }
  });

  it('decays the unreliable at-rest guesses to `unknown`', () => {
    expect(decayUnreliableAgentState('idle', true)).toBe('unknown');
    expect(decayUnreliableAgentState('waiting', true)).toBe('unknown');
    expect(decayUnreliableAgentState('done', true)).toBe('unknown');
  });

  it('keeps `working` (recent bytes = genuinely active) even on an unreliable channel', () => {
    expect(decayUnreliableAgentState('working', true)).toBe('working');
  });

  it('keeps `blocked` (text-detected prompt is reliable) even on an unreliable channel', () => {
    expect(decayUnreliableAgentState('blocked', true)).toBe('blocked');
  });

  it('leaves an already-`unknown` state as `unknown`', () => {
    expect(decayUnreliableAgentState('unknown', true)).toBe('unknown');
  });

  it('never produces a restful state for an unreliable channel (no false "done")', () => {
    for (const state of ALL_STATES) {
      const shown = decayUnreliableAgentState(state, true);
      // The only way to read as "at rest / done" is a state isRestfulAgentState
      // accepts — the decay must have removed every one of those.
      expect(isRestfulAgentState(shown)).toBe(false);
    }
  });
});
