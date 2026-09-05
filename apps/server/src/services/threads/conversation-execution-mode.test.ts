import { describe, expect, it } from 'vitest';
import {
  classifyExecutionMode,
  classifyExecutionModeOption,
  isPlanExecutionMode,
  requestedExecutionModeFromTurn
} from './conversation-execution-mode.js';

describe('classifyExecutionMode', () => {
  it('maps native ids and labels without a provider-id branch', () => {
    expect(classifyExecutionMode('plan')).toBe('plan');
    expect(classifyExecutionMode('Plan', 'Plan')).toBe('plan');
    expect(classifyExecutionMode('ask')).toBe('ask');
    expect(classifyExecutionMode('agent')).toBe('execute');
    expect(classifyExecutionMode('build')).toBe('execute');
    expect(classifyExecutionMode('research', 'Explore')).toBe('custom');
  });

  it('classifies picker options and plan checks', () => {
    expect(classifyExecutionModeOption({ value: 'plan', name: 'Plan' })).toEqual({
      id: 'plan',
      label: 'Plan',
      kind: 'plan'
    });
    expect(isPlanExecutionMode('plan')).toBe(true);
    expect(isPlanExecutionMode('agent')).toBe(false);
    expect(isPlanExecutionMode(null)).toBe(false);
  });
});

describe('requestedExecutionModeFromTurn', () => {
  it('prefers ACP mode, then slash command mentions, then agent', () => {
    expect(requestedExecutionModeFromTurn({ acpMode: 'plan', input: [{ type: 'text', text: 'hi' }] })).toBe('plan');
    expect(requestedExecutionModeFromTurn({
      input: [{
        type: 'text',
        text: '/plan inspect',
        mentions: [{
          start: 0,
          end: 5,
          resource: {
            kind: 'command',
            trigger: '/',
            name: 'plan',
            source: 'command',
            origin: 'builtin',
            label: 'plan',
            argumentHint: null
          }
        }]
      }]
    })).toBe('plan');
    expect(requestedExecutionModeFromTurn({
      input: [{
        type: 'text',
        text: '/goal ship it',
        mentions: [{
          start: 0,
          end: 5,
          resource: {
            kind: 'command',
            trigger: '/',
            name: 'goal',
            source: 'command',
            origin: 'builtin',
            label: 'goal',
            argumentHint: null
          }
        }]
      }]
    })).toBe('goal');
    expect(requestedExecutionModeFromTurn({
      input: [{ type: 'text', text: '/plan inspect' }]
    })).toBe('agent');
    expect(requestedExecutionModeFromTurn({ input: [{ type: 'text', text: 'hi' }] })).toBe('agent');
  });
});
