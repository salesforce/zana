import { describe, it, expect, vi } from 'vitest';
import { installAppPermissions, isAllowedAppPermission } from '../../../window/app-permissions.js';

/** bootstrap() installs this check for both the request and the check handler. */
describe('app window permissions', () => {
  it.each(['media', 'fullscreen'])('grants %s', (permission) => {
    expect(isAllowedAppPermission(permission)).toBe(true);
  });

  it.each(['geolocation', 'notifications', 'clipboard-read', 'pointerLock', 'openExternal', ''])('denies %s', (permission) => {
    expect(isAllowedAppPermission(permission)).toBe(false);
  });

  it('installs the same rule as the request and the check handler', () => {
    const target = { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() };
    installAppPermissions(target);
    const request = target.setPermissionRequestHandler.mock.calls[0][0];
    const check = target.setPermissionCheckHandler.mock.calls[0][0];
    const callback = vi.fn();
    request(null, 'fullscreen', callback);
    request(null, 'geolocation', callback);
    expect(callback.mock.calls).toEqual([[true], [false]]);
    expect(check(null, 'media')).toBe(true);
    expect(check(null, 'notifications')).toBe(false);
  });
});
