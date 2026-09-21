import { afterEach, expect, it, vi } from 'vitest';
import {
  clearNativeProfileSession,
  connectNativeProfile,
  type SessionControllerDeps
} from './session-controller';
import type { MobileSession } from './client';
const profile = {
  id: 'one',
  label: 'Mac',
  serverUrl: 'https://mac.example',
  credential: 'c'.repeat(43)
};
it.each(['ios', 'android'] as const)(
  'forgets the %s session without clearing unrelated cookies',
  async (platform) => {
    const f = setup(platform);
    await clearNativeProfileSession(profile, f.deps);
    expect(f.deps.cookies.set.mock.calls[0]).toEqual([
      profile.serverUrl,
      {
        name: 'zcc_mobile_session',
        value: '',
        path: '/',
        httpOnly: true,
        secure: true,
        expires: new Date(0).toISOString()
      },
      false
    ]);
    expect(f.deps.cookies.set).toHaveBeenCalledTimes(platform === 'ios' ? 2 : 1);
    expect(f.deps.cookies.flush).toHaveBeenCalledTimes(platform === 'android' ? 1 : 0);
  }
);
afterEach(() => vi.useRealTimers());
function setup(platform: 'ios' | 'android' = 'ios') {
  let listener: (state: string) => void = () => {};
  const off = vi.fn();
  const session: MobileSession = {
    expiresAt: Date.now() + 12 * 60 * 60_000,
    cookie: {
      name: 'zcc_mobile_session',
      value: 's'.repeat(43),
      httpOnly: true,
      secure: true,
      expires: new Date(Date.now() + 12 * 60 * 60_000).toISOString(),
      path: '/'
    }
  };
  const deps = {
    platform,
    cookies: { set: vi.fn().mockResolvedValue(true), flush: vi.fn().mockResolvedValue(true) },
    subscribe: (cb: (state: string) => void) => {
      listener = cb;
      return off;
    },
    onReady: vi.fn(),
    onError: vi.fn(),
    onResume: vi.fn(),
    create: vi.fn().mockResolvedValue(session)
  } satisfies SessionControllerDeps;
  return { deps, session, off, state: (state: string) => listener(state) };
}
it('installs both iOS cookie jars before mounting, renews ahead of expiry and disposes', async () => {
  vi.useFakeTimers();
  const f = setup();
  const stop = connectNativeProfile(profile, f.deps);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.deps.cookies.set.mock.calls.map((args) => args[2])).toEqual([false, true]);
  expect(f.deps.onReady).toHaveBeenCalledOnce();
  f.state('background');
  expect(f.deps.onResume).not.toHaveBeenCalled();
  f.state('active');
  expect(f.deps.onResume).toHaveBeenCalledOnce();
  f.session.expiresAt += 12 * 60 * 60_000;
  await vi.advanceTimersByTimeAsync(12 * 60 * 60_000 - 5 * 60_000);
  expect(f.deps.create).toHaveBeenCalledTimes(2);
  stop();
  expect(f.off).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('flushes Android cookies and recovers on foreground after a failed connection', async () => {
  vi.useFakeTimers();
  const f = setup('android');
  f.deps.create.mockRejectedValueOnce(new Error('offline'));
  const stop = connectNativeProfile(profile, f.deps);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.deps.onError).toHaveBeenCalled();
  f.state('active');
  f.state('active');
  await vi.advanceTimersByTimeAsync(0);
  expect(f.deps.create).toHaveBeenCalledTimes(2);
  expect(f.deps.cookies.flush).toHaveBeenCalledOnce();
  expect(f.deps.cookies.set).toHaveBeenCalledTimes(1);
  stop();
});
it('keeps direct profiles timer-free and prevents work after unmount or failed cookie installation', async () => {
  vi.useFakeTimers();
  const direct = setup();
  direct.deps.create.mockResolvedValue(null);
  const stop = connectNativeProfile(profile, direct.deps);
  await vi.advanceTimersByTimeAsync(0);
  expect(direct.deps.onReady).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  stop();
  const cancelled = setup();
  const cancel = connectNativeProfile(profile, cancelled.deps);
  cancel();
  await vi.advanceTimersByTimeAsync(0);
  expect(cancelled.deps.cookies.set).not.toHaveBeenCalled();
  expect(cancelled.deps.onReady).not.toHaveBeenCalled();
  const failed = setup();
  failed.deps.cookies.set.mockRejectedValueOnce(new Error('keychain unavailable'));
  const end = connectNativeProfile(profile, failed.deps);
  await vi.advanceTimersByTimeAsync(0);
  expect(failed.deps.onError).toHaveBeenCalled();
  expect(failed.deps.onReady).not.toHaveBeenCalled();
  end();
});
