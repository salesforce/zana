import { describe, expect, it } from 'vitest';
import { createToolInvocationCorrelation } from './tool-settled-correlation.js';

describe('tool invocation correlation', () => {
  it('returns a remembered id once', () => {
    const c = createToolInvocationCorrelation();
    c.remember('t1', 'call', 'inv');
    expect(c.take('t1', 'call')).toBe('inv');
    expect(c.take('t1', 'call')).toBeUndefined();
  });

  it('scopes by thread', () => {
    const c = createToolInvocationCorrelation();
    c.remember('t1', 'call', 'inv');
    expect(c.take('t2', 'call')).toBeUndefined();
  });

  it.each([-1, Number.NaN, Number.NEGATIVE_INFINITY])('terminates on an invalid capacity %s', (capacity) => {
    const c = createToolInvocationCorrelation(capacity);
    c.remember('t', 'a', '1');
    expect(() => c.take('t', 'a')).not.toThrow();
  });

  it('evicts oldest first at capacity', () => {
    const c = createToolInvocationCorrelation(2);
    c.remember('t', 'a', '1');
    c.remember('t', 'b', '2');
    c.remember('t', 'c', '3');
    expect(c.take('t', 'a')).toBeUndefined();
    expect(c.take('t', 'c')).toBe('3');
  });
});
