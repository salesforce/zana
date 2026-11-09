import { callPluginRpc, type PluginAgentActivitySnapshot, type PluginContentScriptContext } from '@zana-ai/zcc-plugin-sdk/app';
import { SoundPolicy } from './policy.js';
import { SoundPlayer } from './player.js';
import type { SoundState } from './model.js';

let status = 'Choose this provider in Settings → Notifications to enable automatic sounds.';
const listeners = new Set<() => void>();
export const runtimeStatus = { get: () => status, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
function report(message: string) { status = message; listeners.forEach(listener => listener()); }

export function mountBackground(context: PluginContentScriptContext): () => void {
  if (context.signal.aborted) return () => undefined;
  if (!context.experimental_observeAgents || !context.experimental_onSignal || !navigator.locks) {
    report('Automatic notifications need an app update. Imports and previews are available.');
    return () => undefined;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  context.signal.addEventListener('abort', abort, { once: true });
  if (context.signal.aborted) abort();
  // Chromium locks elect one audio owner across windows. Reload/uninstall releases it.
  report('Waiting for the notification player…');
  let started = false;
  let latest: PluginAgentActivitySnapshot = { ready: false, agents: [] };
  let policy: SoundPolicy | undefined;
  const start = () => { void navigator.locks.request(`${context.pluginId}:notification-player`, { signal: controller.signal }, async () => {
    if (controller.signal.aborted) return;
    let state = await callPluginRpc(context.pluginId, 'read') as SoundState;
    if (controller.signal.aborted) return;
    const player = new SoundPlayer();
    policy = new SoundPolicy(() => ({ ...state.preferences, enabled: true }), cue => {
      const pack = state.packs.find(p => p.id === state.preferences.packId);
      const clip = cue === 'idle' ? pack?.idle : pack?.needsYou;
      if (pack && !clip) return;
      void player.play(cue, state.preferences.volume, clip).catch(error => report(`Playback failed: ${error instanceof Error ? error.message : String(error)}`));
    });
    let revision = 0;
    const offSignal = context.experimental_onSignal!('changed', () => {
      const request = ++revision;
      void callPluginRpc(context.pluginId, 'read').then(value => {
        if (controller.signal.aborted || request !== revision) return;
        state = value as SoundState;
        policy?.refresh(); player.stop();
      }).catch(() => report('Could not reload sound settings.'));
    });
    policy.observe(latest);
    report('Notification player ready');
    try {
      await new Promise<void>(resolve => {
        if (controller.signal.aborted) resolve();
        else controller.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    } finally { offSignal(); policy?.dispose(); policy = undefined; player.stop(); }
  }).catch(error => { if (!controller.signal.aborted) report(`Notification player unavailable: ${error instanceof Error ? error.message : String(error)}`); }); };
  // Scoped windows never become ready and therefore cannot steal playback ownership.
  const offAgents = context.experimental_observeAgents(snapshot => {
    latest = snapshot;
    policy?.observe(snapshot);
    if (!started && snapshot.ready && !controller.signal.aborted) { started = true; start(); }
  });
  controller.signal.addEventListener('abort', offAgents, { once: true });
  return () => { context.signal.removeEventListener('abort', abort); offAgents(); abort(); };
}
