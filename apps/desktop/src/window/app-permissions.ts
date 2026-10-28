import type { Session } from 'electron';

/**
 * Permissions the app's own windows (default session) may use: the microphone
 * for voice-to-text, and HTML fullscreen so bundled videos can fill the screen.
 * Everything else is denied.
 */
const APP_PERMISSIONS: ReadonlySet<string> = new Set(['media', 'fullscreen']);

export function isAllowedAppPermission(permission: string): boolean {
  return APP_PERMISSIONS.has(permission);
}

/**
 * getUserMedia consults BOTH the request handler (interactive grant) and the
 * synchronous check handler — without the latter, Chromium can silently deny
 * the mic even after entitlements are in place. Install once at init (not in
 * createWindow).
 */
export function installAppPermissions(target: Pick<Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler'>): void {
  target.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(isAllowedAppPermission(permission));
  });
  target.setPermissionCheckHandler((_wc, permission) => isAllowedAppPermission(permission));
}
