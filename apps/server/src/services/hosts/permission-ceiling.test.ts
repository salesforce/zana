import { describe, expect, it } from 'vitest';
import { clampPermissionModeToCeiling } from '@zana-ai/zcc-domain/thread-runtime';

describe('host permission ceiling', () => {
  it('passes through a mode at or below the ceiling', () => {
    expect(clampPermissionModeToCeiling({
      ceiling: 'auto',
      permissionMode: 'accept-edits'
    })).toBe('accept-edits');
    expect(clampPermissionModeToCeiling({
      ceiling: 'full',
      permissionMode: 'full'
    })).toBe('full');
  });

  it('lowers a mode above the ceiling to the highest allowed', () => {
    expect(clampPermissionModeToCeiling({
      ceiling: 'accept-edits',
      permissionMode: 'full'
    })).toBe('accept-edits');
    expect(clampPermissionModeToCeiling({
      ceiling: 'auto',
      permissionMode: 'full',
      permissionModes: ['auto', 'full']
    })).toBe('auto');
  });
});
