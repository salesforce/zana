/**
 * Derive the stable plugin id used for routes, storage, settings, and CLI
 * commands from an npm package name.
 *
 * `@zana/tasks` and `zcc-plugin-tasks` both become `tasks`; scoped names first
 * drop the scope. Host chrome uses the reserved sentinel {@link BUILTIN_NAV_SENTINEL}.
 */
export const BUILTIN_NAV_SENTINEL = '__builtin__';

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function derivePluginId(packageName: string): string {
  // Check the raw name first: sanitization turns `__builtin__` into `builtin`,
  // which would otherwise pass the pattern and mint the reserved sentinel.
  if (packageName === BUILTIN_NAV_SENTINEL) {
    throw new Error(`cannot derive a plugin id from package name "${packageName}"`);
  }
  const base = packageName.includes('/')
    ? (packageName.split('/').at(-1) ?? packageName)
    : packageName;
  const id = base
    .replace(/^(zcc|zana)-plugin-/, '')
    .replace(/^@/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '');
  if (id.length === 0 || id === BUILTIN_NAV_SENTINEL || !PLUGIN_ID_PATTERN.test(id)) {
    throw new Error(`cannot derive a plugin id from package name "${packageName}"`);
  }
  return id;
}

export function isPluginId(value: string): boolean {
  return PLUGIN_ID_PATTERN.test(value) && value !== BUILTIN_NAV_SENTINEL;
}
