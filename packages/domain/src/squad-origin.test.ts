import { describe, expect, it } from 'vitest';
import { MODERN_SQUAD_PRIVATE_NAMESPACE, MODERN_SQUAD_THREAD_ORIGIN } from './squad-origin.js';

describe('Modern squad origin', () => {
  it('derives the private namespace as a dot-prefixed, plugin-unaddressable id', () => {
    expect(MODERN_SQUAD_THREAD_ORIGIN).toBe('host-modern-squad');
    expect(MODERN_SQUAD_PRIVATE_NAMESPACE).toBe(`.${MODERN_SQUAD_THREAD_ORIGIN}`);
  });
});
