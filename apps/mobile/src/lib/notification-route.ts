import type { ServerProfile } from './profiles';
import { safePath } from './urls';
export function notificationRoute(data: unknown, profiles: ServerProfile[]): string | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  if (
    typeof value.serverUrl !== 'string' ||
    typeof value.path !== 'string' ||
    !profiles.some((p) => p.serverUrl === value.serverUrl)
  )
    return null;
  const path = safePath(value.path);
  if (!path.startsWith('/threads/')) return null;
  return `/?server=${encodeURIComponent(value.serverUrl)}&path=${encodeURIComponent(path)}`;
}
