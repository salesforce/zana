import { useEffect } from 'react';
import { create } from 'zustand';
import { fetchVoiceStatus, product } from '../../../lib/product-client.js';
import { useData } from '../../../store.js';
import type { VoiceAvailability } from './voice-helpers.js';

const FOCUS_REFRESH_MIN_MS = 5_000;

interface VoiceStatusState {
  availability: VoiceAvailability;
  /** Re-reads host readiness. No-op while dictation is off in Experimental. `force` re-fetches after an in-flight request instead of joining it. */
  refresh: (options?: { force?: boolean }) => Promise<void>;
}

let inflight: Promise<void> | null = null;
// Set when a refresh is requested mid-fetch (e.g. a host connects while a
// `no_host` probe is pending). The stale reply is applied, then one more fetch
// runs so the final state reflects the latest roster instead of the old one.
let dirty = false;
// Bumped whenever a result must be discarded (toggle turned off, test reset) so a
// fetch that was in flight at that moment cannot overwrite the reset state.
let generation = 0;

export const useVoiceStatus = create<VoiceStatusState>((set, get) => ({
  availability: { state: 'unknown', reason: null },
  refresh({ force = false } = {}) {
    if (!useData.getState().voiceInputEnabled) {
      generation += 1;
      inflight = null;
      dirty = false;
      set({ availability: { state: 'unknown', reason: null } });
      return Promise.resolve();
    }
    if (inflight) {
      // Focus and duplicate triggers only join; a state-changing trigger must
      // observe the world after the in-flight probe started.
      if (!force) return inflight;
      dirty = true;
      return inflight;
    }
    const mine = generation;
    const apply = (availability: VoiceAvailability) => {
      if (mine === generation) set({ availability });
    };
    const request: Promise<void> = fetchVoiceStatus()
      .then((body) => apply(body.enabled
        ? { state: 'ready', reason: null }
        : { state: 'unavailable', reason: body.reason ?? 'no_host' }))
      // An unreachable status route is not proof voice is broken: keep the
      // mic usable and let a real attempt report the precise error.
      .catch(() => apply({ state: 'ready', reason: null }))
      .finally(() => {
        if (inflight !== request) return;
        inflight = null;
        if (dirty) {
          dirty = false;
          void get().refresh();
        }
      });
    inflight = request;
    return request;
  }
}));

let syncStarted = false;
let lastFocusRefresh = 0;
let releaseSync: (() => void) | null = null;

/**
 * One app-lifetime subscription (Rule 3): refresh when the Experimental toggle
 * turns on, and when the window regains focus so a fresh `codex login` is
 * picked up without a reload. Idempotent; safe to call from every consumer.
 */
export function startVoiceStatusSync(): void {
  if (syncStarted) return;
  syncStarted = true;
  let wasEnabled = useData.getState().voiceInputEnabled;
  if (wasEnabled) void useVoiceStatus.getState().refresh();
  const releases: Array<() => void> = [];
  releases.push(useData.subscribe((state) => {
    if (state.voiceInputEnabled === wasEnabled) return;
    wasEnabled = state.voiceInputEnabled;
    void useVoiceStatus.getState().refresh({ force: true });
  }));
  // A host connecting or leaving changes no_host / ambiguous_host / auth state.
  releases.push(product.hosts.onChanged(() => {
    if (!useData.getState().voiceInputEnabled) return;
    void useVoiceStatus.getState().refresh({ force: true });
  }));
  if (typeof window !== 'undefined') {
    const onFocus = () => {
      const now = Date.now();
      if (!useData.getState().voiceInputEnabled || now - lastFocusRefresh < FOCUS_REFRESH_MIN_MS) return;
      lastFocusRefresh = now;
      void useVoiceStatus.getState().refresh();
    };
    window.addEventListener('focus', onFocus);
    releases.push(() => window.removeEventListener('focus', onFocus));
  }
  releaseSync = () => { for (const release of releases) release(); };
}

/** For tests: forget the one-time subscription guard and cached state. */
export function resetVoiceStatusForTests(): void {
  releaseSync?.();
  releaseSync = null;
  generation += 1;
  syncStarted = false;
  lastFocusRefresh = 0;
  inflight = null;
  dirty = false;
  useVoiceStatus.setState({ availability: { state: 'unknown', reason: null } });
}

/** The Experimental toggle plus host readiness — what every mic button reads. */
export function useVoiceAvailability(): { enabled: boolean; availability: VoiceAvailability } {
  const enabled = useData((s) => s.voiceInputEnabled);
  const availability = useVoiceStatus((s) => s.availability);
  useEffect(startVoiceStatusSync, []);
  return { enabled, availability };
}
