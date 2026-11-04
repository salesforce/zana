import type { BrowserWindow } from 'electron';
import {
  CORE_APPROVAL_PRINCIPAL,
  parsePluginApprovalRequest,
  signPluginApproval,
  type PluginApprovalRequest
} from '@zana-ai/zcc-server/http/plugin-approval-proof';
import type { ApprovalSheetOutcome, ApprovalSheetView } from '../window/approval-sheet.js';

const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The only action main signs on this channel; a server bug cannot get another binding signed with the core principal. */
export const USE_APPROVE_ACTION = 'peer.use.approve';
export const USE_STOP_ACTION = 'peer.use.stop';
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const NO_WINDOW_RETRY_MS = 2_000;
const LINE_MAX = 256 * 1024;

export interface PeerUsePromptDeps {
  /** The product server's UI signing secret; renderers and plugins never see it. */
  secret(): string;
  /** Base URL of the product server (loopback). */
  serverUrl(): string;
  /** Main's own view of installed plugins, never the server's or a renderer's. */
  listApps(): Promise<ReadonlyArray<{ id: string; name: string; enabled: boolean; status: string }>>;
  showSheet(parent: BrowserWindow, view: ApprovalSheetView): Promise<ApprovalSheetOutcome>;
  /** The window the sheet attaches to: the focused one, else the main one. `null` while no window exists. */
  pickParent(): BrowserWindow | null;
  fetch?: typeof fetch;
  now?(): number;
  log?(message: string, error?: unknown): void;
}

interface Prompt { id: string; pluginId: string; request: PluginApprovalRequest }

function parsePrompts(raw: unknown): Prompt[] {
  const list = raw && typeof raw === 'object' ? (raw as { prompts?: unknown }).prompts : undefined;
  if (!Array.isArray(list)) return [];
  const out: Prompt[] = [];
  for (const item of list.slice(0, 16)) {
    const row = item as { id?: unknown; pluginId?: unknown; request?: unknown } | null;
    if (!row || typeof row.id !== 'string' || !UUID.test(row.id) || typeof row.pluginId !== 'string' || !PLUGIN_ID.test(row.pluginId)) continue;
    const request = parsePluginApprovalRequest(row.request);
    if (!request.ok) continue;
    const { binding } = request.value;
    if ((binding.action !== USE_APPROVE_ACTION && binding.action !== USE_STOP_ACTION) || binding.subject !== `use:${row.pluginId}` || binding.revision !== row.id || binding.confirmText) continue;
    out.push({ id: row.id, pluginId: row.pluginId, request: request.value });
  }
  return out;
}

/**
 * Core push signal consumer. The product server streams the use approvals this computer's owner still owes; main
 * draws its own sheet for each (one at a time, on the focused window), signs only the binding it showed, and answers
 * the server, which verifies the proof before it records anything. Subscribed once at app init; `stop` releases the
 * stream and every timer.
 */
export function startPeerUsePrompts(deps: PeerUsePromptDeps): { stop(): void } {
  const doFetch = deps.fetch ?? fetch;
  const log = deps.log ?? (() => undefined);
  const stopped = new AbortController();
  const queue: Prompt[] = [];
  let current = new Set<string>();
  const handled = new Set<string>();
  let working = false;
  const sleep = (ms: number) => new Promise<void>(resolve => {
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); stopped.signal.removeEventListener('abort', done); resolve(); }
    stopped.signal.addEventListener('abort', done, { once: true });
  });

  const answer = async (id: string, body: { approved: boolean; token?: string }): Promise<void> => {
    try {
      const response = await doFetch(new URL(`api/v1/peer-uses/${id}/decision`, deps.serverUrl()), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([stopped.signal, AbortSignal.timeout(15_000)])
      });
      if (!response.ok) log(`peer use answer rejected (${response.status})`);
    } catch (error) { if (!stopped.signal.aborted) log('peer use answer failed', error); }
  };

  const handle = async (prompt: Prompt): Promise<void> => {
    const app = (await deps.listApps()).find(row => row.id === prompt.pluginId);
    if (!app || !app.enabled || app.status === 'disabled') { await answer(prompt.id, { approved: false }); return; }
    let parent = deps.pickParent();
    while (!parent && !stopped.signal.aborted) {
      await sleep(NO_WINDOW_RETRY_MS);
      if (!current.has(prompt.id)) return;
      parent = deps.pickParent();
    }
    if (!parent || stopped.signal.aborted || parent.isDestroyed()) return;
    const secret = deps.secret();
    if (secret.length < 32) return;
    const outcome = await deps.showSheet(parent, { pluginName: app.name, request: prompt.request });
    if (stopped.signal.aborted) return;
    if (outcome.kind !== 'approved') { await answer(prompt.id, { approved: false }); return; }
    await answer(prompt.id, { approved: true, token: signPluginApproval(secret, CORE_APPROVAL_PRINCIPAL, prompt.request.binding, deps.now?.() ?? Date.now()) });
  };

  const drain = async (): Promise<void> => {
    if (working) return;
    working = true;
    try {
      for (let prompt = queue.shift(); prompt && !stopped.signal.aborted; prompt = queue.shift()) {
        // Withdrawn while it waited (answered elsewhere, peer denied, connection removed): never show a stale sheet.
        if (!current.has(prompt.id)) continue;
        try { await handle(prompt); } catch (error) { log('peer use prompt failed', error); }
      }
    } finally { working = false; }
  };

  const onSnapshot = (prompts: Prompt[]): void => {
    current = new Set(prompts.map(prompt => prompt.id));
    for (const id of [...handled]) if (!current.has(id)) handled.delete(id);
    for (const prompt of prompts) {
      if (handled.has(prompt.id)) continue;
      handled.add(prompt.id);
      queue.push(prompt);
    }
    void drain();
  };

  const run = async (): Promise<void> => {
    let delay = RECONNECT_MIN_MS;
    while (!stopped.signal.aborted) {
      try {
        const response = await doFetch(new URL('api/v1/peer-uses/prompts', deps.serverUrl()), { signal: stopped.signal });
        if (response.ok && response.body) {
          delay = RECONNECT_MIN_MS;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffered = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffered += decoder.decode(value, { stream: true });
            if (buffered.length > LINE_MAX && !buffered.includes('\n')) throw new Error('peer use stream line too long');
            let newline = buffered.indexOf('\n');
            while (newline >= 0) {
              const line = buffered.slice(0, newline).trim();
              buffered = buffered.slice(newline + 1);
              newline = buffered.indexOf('\n');
              if (!line) continue;
              let parsed: unknown;
              try { parsed = JSON.parse(line); } catch { continue; }
              if (parsed && typeof parsed === 'object' && 'prompts' in parsed) onSnapshot(parsePrompts(parsed));
            }
          }
        }
      } catch (error) {
        if (stopped.signal.aborted) return;
        log('peer use stream interrupted', error);
      }
      // A dropped stream means the server restarted or stalled: forget what is shown so the next snapshot re-asks.
      current = new Set();
      handled.clear();
      if (stopped.signal.aborted) return;
      await sleep(delay);
      delay = Math.min(delay * 2, RECONNECT_MAX_MS);
    }
  };

  void run();
  return {
    stop() {
      stopped.abort();
      queue.length = 0;
      current = new Set();
      handled.clear();
    }
  };
}
