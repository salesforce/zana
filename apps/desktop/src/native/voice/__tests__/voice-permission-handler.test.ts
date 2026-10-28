import { describe, it, expect } from 'vitest';
import { isAllowedAppPermission } from '../../../window/app-permissions.js';

/** bootstrap() installs this check for both the request and the check handler. */
describe('app window permissions', () => {
  it.each(['media', 'fullscreen'])('grants %s', (permission) => {
    expect(isAllowedAppPermission(permission)).toBe(true);
  });

  it.each(['geolocation', 'notifications', 'clipboard-read', 'pointerLock', 'openExternal', ''])('denies %s', (permission) => {
    expect(isAllowedAppPermission(permission)).toBe(false);
  });
});
