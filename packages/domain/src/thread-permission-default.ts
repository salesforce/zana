import type { PermissionMode } from './bb-thread/index.js';

/** Resolve a default without silently granting a more permissive policy. */
export function supportedThreadPermissionDefault(
  preferred: PermissionMode,
  supported: readonly string[]
): PermissionMode | undefined {
  if (supported.includes(preferred)) return preferred;
  if (supported.includes('accept-edits')) return 'accept-edits';
  if (preferred === 'full' && supported.includes('auto')) return 'auto';
  return undefined;
}
