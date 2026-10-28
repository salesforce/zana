/**
 * Permissions the app's own windows (default session) may use: the microphone
 * for voice-to-text, and HTML fullscreen so bundled videos can fill the screen.
 * Everything else is denied.
 */
const APP_PERMISSIONS: ReadonlySet<string> = new Set(['media', 'fullscreen']);

export function isAllowedAppPermission(permission: string): boolean {
  return APP_PERMISSIONS.has(permission);
}
