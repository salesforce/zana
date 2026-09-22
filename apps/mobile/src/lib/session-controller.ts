import { createSession, type MobileSession, type SessionCookie } from './client';
import type { ServerProfile } from './profiles';
export interface SessionControllerDeps {
  platform: 'ios' | 'android';
  cookies: {
    set(url: string, cookie: SessionCookie, webkit: boolean): Promise<unknown>;
    flush(): Promise<unknown>;
  };
  subscribe(listener: (state: string) => void): () => void;
  onReady(): void;
  onError(error: unknown): void;
  onResume(): void;
  create?: (profile: ServerProfile) => Promise<MobileSession | null>;
  now?: () => number;
}

/** Expire only this server's gateway cookie, leaving unrelated browser state alone. */
export async function clearNativeProfileSession(
  profile: ServerProfile,
  deps: Pick<SessionControllerDeps, 'platform' | 'cookies'>
) {
  const cookie: SessionCookie = {
    name: 'zcc_mobile_session',
    value: '',
    path: '/',
    httpOnly: true,
    secure: profile.serverUrl.startsWith('https:'),
    expires: new Date(0).toISOString()
  };
  await deps.cookies.set(profile.serverUrl, cookie, false);
  if (deps.platform === 'ios') await deps.cookies.set(profile.serverUrl, cookie, true);
  else await deps.cookies.flush();
}
/** Owns exactly one renewal timer and AppState subscription for the active profile. */
export function connectNativeProfile(
  profile: ServerProfile,
  deps: SessionControllerDeps
): () => void {
  let live = true;
  let refreshing = false;
  let expiresAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const now = deps.now ?? Date.now;
  const refresh = async () => {
    if (!live || refreshing) return;
    refreshing = true;
    try {
      const session = await (deps.create ?? createSession)(profile);
      if (!live) return;
      if (session) {
        await deps.cookies.set(profile.serverUrl, session.cookie, false);
        if (!live) return;
        if (deps.platform === 'ios')
          await deps.cookies.set(profile.serverUrl, session.cookie, true);
        else await deps.cookies.flush();
      }
      if (!live) return;
      expiresAt = session?.expiresAt ?? Infinity;
      deps.onReady();
      if (session)
        timer = setTimeout(() => void refresh(), Math.max(1000, expiresAt - now() - 5 * 60_000));
    } catch (error) {
      if (live) deps.onError(error);
    } finally {
      refreshing = false;
    }
  };
  void refresh();
  const off = deps.subscribe((state) => {
    if (state !== 'active') return;
    if (now() + 5 * 60_000 >= expiresAt) {
      clearTimeout(timer);
      void refresh();
    } else deps.onResume();
  });
  return () => {
    live = false;
    clearTimeout(timer);
    off();
  };
}
