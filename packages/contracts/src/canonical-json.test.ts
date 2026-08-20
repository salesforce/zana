import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json.js';

describe('canonicalJson', () => {
  it('is invariant to object insertion order at every nesting level', () => {
    expect(canonicalJson({ b: [{ z: 1, a: 2 }], a: true })).toBe(canonicalJson({ a: true, b: [{ a: 2, z: 1 }] }));
  });
});
