import { describe, expect, it } from 'vitest';
import { supportedThreadPermissionDefault } from './thread-permission-default.js';

describe('shared thread permission defaults', () => {
  it.each(['accept-edits', 'auto', 'full'] as const)('keeps supported %s', preferred => {
    expect(supportedThreadPermissionDefault(preferred, ['accept-edits', 'auto', 'full'])).toBe(preferred);
  });
  it.each(['auto', 'full'] as const)('falls back from %s to Edits', preferred => {
    expect(supportedThreadPermissionDefault(preferred, ['accept-edits'])).toBe('accept-edits');
  });
  it('can restrict Full to automatic review', () => {
    expect(supportedThreadPermissionDefault('full', ['auto'])).toBe('auto');
  });
  it.each([
    ['accept-edits', ['auto', 'full']], ['auto', ['full']], ['full', []]
  ] as const)('refuses to broaden %s', (preferred, supported) => {
    expect(supportedThreadPermissionDefault(preferred, supported)).toBeUndefined();
  });
});
