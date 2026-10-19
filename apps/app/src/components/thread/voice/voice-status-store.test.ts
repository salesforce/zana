// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchVoiceStatus: vi.fn(), on: { value: true }, listeners: new Set<(s: any) => void>(), hostListeners: new Set<() => void>() }));
vi.mock('../../../lib/product-client.js', () => ({
  fetchVoiceStatus: mocks.fetchVoiceStatus,
  product: { hosts: { onChanged: (fn: () => void) => { mocks.hostListeners.add(fn); return () => mocks.hostListeners.delete(fn); } } }
}));
vi.mock('../../../store.js', () => ({
  useData: Object.assign((select: any) => select({ voiceInputEnabled: mocks.on.value }), {
    getState: () => ({ voiceInputEnabled: mocks.on.value }),
    subscribe: (fn: (s: any) => void) => { mocks.listeners.add(fn); return () => mocks.listeners.delete(fn); }
  })
}));

async function load() {
  vi.resetModules();
  const mod = await import('./voice-status-store.js');
  mod.resetVoiceStatusForTests();
  return mod;
}
const setToggle = (on: boolean) => { mocks.on.value = on; for (const fn of mocks.listeners) fn({ voiceInputEnabled: on }); };

beforeEach(() => { vi.clearAllMocks(); mocks.on.value = true; mocks.listeners.clear(); mocks.hostListeners.clear(); });
afterEach(() => vi.useRealTimers());

it('maps host status to availability and dedupes concurrent refreshes', async () => {
  mocks.fetchVoiceStatus.mockResolvedValue({ enabled: false, reason: 'auth_missing' });
  const { useVoiceStatus } = await load();
  await Promise.all([useVoiceStatus.getState().refresh(), useVoiceStatus.getState().refresh()]);
  expect(mocks.fetchVoiceStatus).toHaveBeenCalledTimes(1);
  expect(useVoiceStatus.getState().availability).toEqual({ state: 'unavailable', reason: 'auth_missing' });
  mocks.fetchVoiceStatus.mockResolvedValue({ enabled: true });
  await useVoiceStatus.getState().refresh();
  expect(useVoiceStatus.getState().availability).toEqual({ state: 'ready', reason: null });
  mocks.fetchVoiceStatus.mockResolvedValue({ enabled: false });
  await useVoiceStatus.getState().refresh();
  expect(useVoiceStatus.getState().availability).toEqual({ state: 'unavailable', reason: 'no_host' });
});

it('stays usable when the status route is unreachable', async () => {
  mocks.fetchVoiceStatus.mockRejectedValue(new Error('offline'));
  const { useVoiceStatus } = await load();
  await useVoiceStatus.getState().refresh();
  expect(useVoiceStatus.getState().availability).toEqual({ state: 'ready', reason: null });
});

it('does not call the host while dictation is off', async () => {
  mocks.on.value = false;
  const { useVoiceStatus } = await load();
  await useVoiceStatus.getState().refresh();
  expect(mocks.fetchVoiceStatus).not.toHaveBeenCalled();
  expect(useVoiceStatus.getState().availability.state).toBe('unknown');
});

it('syncs once: refreshes on toggle-on and on throttled window focus', async () => {
  mocks.fetchVoiceStatus.mockResolvedValue({ enabled: true });
  mocks.on.value = false;
  const { startVoiceStatusSync, useVoiceStatus } = await load();
  const settle = () => useVoiceStatus.getState().refresh(); // joins any in-flight fetch
  const calls = () => mocks.fetchVoiceStatus.mock.calls.length;
  startVoiceStatusSync(); startVoiceStatusSync();
  expect(mocks.listeners.size).toBe(1);
  expect(mocks.fetchVoiceStatus).not.toHaveBeenCalled();
  setToggle(true);
  await vi.waitFor(() => expect(calls()).toBe(1));
  await settle(); // joins the in-flight toggle fetch (dedupe), then clears it
  await vi.waitFor(() => expect(useVoiceStatus.getState().availability.state).toBe('ready'));
  const base = calls();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(100_000);
  window.dispatchEvent(new Event('focus'));
  await vi.waitFor(() => expect(calls()).toBe(base + 1));
  await settle();
  vi.setSystemTime(102_000);
  window.dispatchEvent(new Event('focus'));
  expect(calls()).toBe(base + 1);
  vi.setSystemTime(106_000);
  window.dispatchEvent(new Event('focus'));
  await vi.waitFor(() => expect(calls()).toBe(base + 2));
  await settle();
  setToggle(false);
  vi.setSystemTime(120_000);
  window.dispatchEvent(new Event('focus'));
  expect(calls()).toBe(base + 2);
});

it('refreshes when the host roster changes, only while dictation is on', async () => {
  mocks.fetchVoiceStatus.mockResolvedValue({ enabled: false, reason: 'no_host' });
  const { startVoiceStatusSync, useVoiceStatus } = await load();
  startVoiceStatusSync();
  expect(mocks.hostListeners.size).toBe(1);
  await vi.waitFor(() => expect(mocks.fetchVoiceStatus).toHaveBeenCalledTimes(1));
  await useVoiceStatus.getState().refresh();
  mocks.fetchVoiceStatus.mockResolvedValue({ enabled: true });
  for (const fn of mocks.hostListeners) fn();
  await vi.waitFor(() => expect(useVoiceStatus.getState().availability.state).toBe('ready'));
  expect(mocks.fetchVoiceStatus).toHaveBeenCalledTimes(2);
  mocks.on.value = false;
  for (const fn of mocks.hostListeners) fn();
  expect(mocks.fetchVoiceStatus).toHaveBeenCalledTimes(2);
});

it('resetVoiceStatusForTests releases the toggle, host and focus listeners', async () => {
  mocks.fetchVoiceStatus.mockResolvedValue({ enabled: true });
  const { startVoiceStatusSync, resetVoiceStatusForTests, useVoiceStatus } = await load();
  const remove = vi.spyOn(window, 'removeEventListener');
  startVoiceStatusSync();
  await useVoiceStatus.getState().refresh();
  expect(mocks.listeners.size).toBe(1);
  expect(mocks.hostListeners.size).toBe(1);
  resetVoiceStatusForTests();
  expect(mocks.listeners.size).toBe(0);
  expect(mocks.hostListeners.size).toBe(0);
  expect(remove).toHaveBeenCalledWith('focus', expect.any(Function));
  remove.mockRestore();
});

it('a refresh in flight when dictation turns off cannot overwrite the reset', async () => {
  let resolve!: (v: { enabled: boolean }) => void;
  mocks.fetchVoiceStatus.mockReturnValue(new Promise((r) => { resolve = r; }));
  const { useVoiceStatus } = await load();
  const pending = useVoiceStatus.getState().refresh();
  mocks.on.value = false;
  await useVoiceStatus.getState().refresh();
  resolve({ enabled: true });
  await pending;
  expect(useVoiceStatus.getState().availability).toEqual({ state: 'unknown', reason: null });
  // A later enable starts a fresh fetch rather than joining the stale one.
  mocks.on.value = true;
  mocks.fetchVoiceStatus.mockResolvedValue({ enabled: false, reason: 'disabled' });
  await useVoiceStatus.getState().refresh();
  expect(useVoiceStatus.getState().availability).toEqual({ state: 'unavailable', reason: 'disabled' });
});

it('re-fetches after a mid-flight roster change so a host that connected is not missed', async () => {
  const resolvers: Array<(v: { enabled: boolean; reason?: string }) => void> = [];
  mocks.fetchVoiceStatus.mockImplementation(() => new Promise((r) => { resolvers.push(r); }));
  const { startVoiceStatusSync, useVoiceStatus } = await load();
  startVoiceStatusSync();
  const first = useVoiceStatus.getState().refresh();
  expect(mocks.fetchVoiceStatus).toHaveBeenCalledTimes(1);
  for (const fn of mocks.hostListeners) fn();
  resolvers[0]({ enabled: false, reason: 'no_host' });
  await first;
  await vi.waitFor(() => expect(mocks.fetchVoiceStatus).toHaveBeenCalledTimes(2));
  resolvers[1]({ enabled: true });
  await vi.waitFor(() => expect(useVoiceStatus.getState().availability).toEqual({ state: 'ready', reason: null }));
});

