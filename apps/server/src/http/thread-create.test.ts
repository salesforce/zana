import { describe, expect, it } from 'vitest';
import { resolveProviderFamily } from './thread-create.js';

describe('resolveProviderFamily', () => {
  it('maps a concrete profile onto its harness family', () => {
    expect(resolveProviderFamily('claude')).toBe('claude');
    expect(resolveProviderFamily('claude-yolo')).toBe('claude');
    expect(resolveProviderFamily('codex-resume')).toBe('codex');
  });

  it('rejects unknown ids', () => {
    expect(resolveProviderFamily('not-a-harness')).toBeNull();
  });
});
