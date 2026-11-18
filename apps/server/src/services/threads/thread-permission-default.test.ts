import { afterEach, describe, expect, it } from 'vitest';
import { permissionModeForNewThread } from './thread-permission-default.js';
import { registerThreadProvider } from './thread-provider-catalog.js';

let unregister = () => {};
afterEach(() => unregister());
function provider(modes: Array<'accept-edits' | 'auto' | 'full'>) {
  unregister = registerThreadProvider('permissions-fixture', {
    id: 'permissions-fixture', displayName: 'Fixture', composerActions: [],
    capabilities: { supportsServiceTier: false, fork: 'none', supportsManualCompaction: false,
      supportsThreadArchive: false, supportsThreadRename: false, permissionModes: modes }
  }).unregister;
}
describe('new thread launch permissions', () => {
  it.each(['accept-edits', 'auto', 'full'] as const)('inherits configured %s', mode => {
    provider(['accept-edits', 'auto', 'full']);
    expect(permissionModeForNewThread('permissions-fixture', undefined, mode)).toBe(mode);
  });
  it.each(['accept-edits', 'auto', 'full'] as const)('keeps explicit %s over a shared default', mode => {
    provider(['accept-edits', 'auto', 'full']);
    expect(permissionModeForNewThread('permissions-fixture', mode, 'auto')).toBe(mode);
  });
  it('preserves legacy provider fallback and an explicit YOLO profile', () => {
    provider(['full']);
    expect(permissionModeForNewThread('permissions-fixture', undefined, null)).toBe('full');
    expect(permissionModeForNewThread('permissions-fixture', undefined, undefined)).toBe('full');
    expect(permissionModeForNewThread('claude-yolo', undefined, 'accept-edits')).toBe('full');
  });
  it('uses a more restrictive supported mode', () => {
    provider(['accept-edits']);
    expect(permissionModeForNewThread('permissions-fixture', undefined, 'auto')).toBe('accept-edits');
  });
  it('refuses to silently broaden the configured policy', () => {
    provider(['full']);
    expect(() => permissionModeForNewThread('permissions-fixture', undefined, 'accept-edits'))
      .toThrow(/Choose permissions for this launch/);
  });
  it('keeps unknown providers actionable', () => {
    expect(() => permissionModeForNewThread('removed-provider', undefined, 'auto')).toThrow(/unknown thread provider/);
  });
});
