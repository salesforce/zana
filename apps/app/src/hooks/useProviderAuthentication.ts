import { useCallback, useEffect, useRef, useState } from 'react';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import { providerReadinessResultSchema, type ProviderReadinessResponse, type ProviderReadinessResult } from '@zana-ai/zcc-server-contract';
import { apiJson } from '../lib/fetch-with-app-surface.js';
import { hasDesktopBridge } from '../lib/app-surface.js';
import { product } from '../lib/product-client.js';

interface State {
  result: ProviderReadinessResult | null;
  checking: boolean;
  starting: boolean;
  session: TerminalSession | null;
  error: string | null;
}
const initial: State = { result: null, checking: false, starting: false, session: null, error: null };
interface Actions { check(): Promise<void>; start(): Promise<void>; cancel(): Promise<void> }

/** BB-style guided sign-in: process exit is never proof of authentication. */
export function useProviderAuthentication(providerId: string, hostId: string | undefined, onReady: () => void) {
  const [state, setState] = useState<State>(initial);
  const actions = useRef<Actions | null>(null);
  const ready = useRef(onReady);
  ready.current = onReady;
  useEffect(() => {
    let disposed = false;
    let operation = 0;
    let starting = false;
    let session: TerminalSession | null = null;
    const earlyExits = new Map<string, number>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: Promise<void> | null = null;
    let lastStatus: string | undefined;
    const abort = new AbortController();
    const path = `/system/providers/${encodeURIComponent(providerId)}`;
    const patch = (value: Partial<State>) => { if (!disposed) setState((current) => ({ ...current, ...value })); };
    const stop = async (active: TerminalSession) => {
      const result = await product.terminals.close(active.id);
      if (!result) throw new Error('Could not close the sign-in terminal. Reconnect and cancel again.');
    };
    const check = (): Promise<void> => {
      if (!hostId || disposed) return Promise.resolve();
      clearTimeout(timer);
      if (pending) return pending;
      patch({ checking: true });
      pending = (async () => {
        try {
          const response = await apiJson<ProviderReadinessResponse>(`${path}/health?hostId=${encodeURIComponent(hostId)}`, { signal: abort.signal });
          if (disposed) return;
          if (response.hostId !== hostId || response.providerId !== providerId) throw new Error('Mismatched provider scope');
          const result = providerReadinessResultSchema.parse(response.result);
          patch({ result, error: null });
          const status = result.supported ? result.health.status : undefined;
          if (status === 'ready' && session) {
            await stop(session);
            session = null;
            patch({ session: null });
          }
          if (disposed) return;
          if (status === 'ready' && lastStatus !== 'ready') ready.current();
          lastStatus = status;
        } catch {
          patch({ result: null, error: 'Could not check provider status on this machine. Reconnect and try again.' });
        } finally {
          pending = null;
          patch({ checking: false });
          if (!disposed && session?.status !== 'exited' && session) timer = setTimeout(() => { void check(); }, 3_000);
        }
      })();
      return pending;
    };
    const cancel = async () => {
      operation++;
      clearTimeout(timer);
      if (session) {
        try { await stop(session); session = null; patch({ session: null, error: null }); }
        catch { patch({ error: 'Could not close the sign-in terminal. Reconnect and cancel again.' }); }
      }
    };
    const start = async () => {
      if (!hostId || disposed || starting || session?.status === 'running') return;
      const current = ++operation;
      starting = true;
      patch({ starting: true, error: null });
      try {
        // Do not abort this mutation: a late acknowledgement still owns a terminal to close.
        const response = await apiJson<{ ok: true; value: TerminalSession }>(`${path}/sign-in`, {
          method: 'POST', body: JSON.stringify({ hostId, localBrowser: hasDesktopBridge() }),
        });
        const exited = earlyExits.get(response.value.id);
        const active = exited === undefined ? response.value : { ...response.value, status: 'exited' as const, exitCode: exited };
        if (disposed || operation !== current) { await stop(active); return; }
        session = active;
        patch({ session: active });
        await check();
      } catch {
        patch({ error: 'Could not start sign-in. Check provider status and try again.' });
      } finally {
        starting = false;
        earlyExits.clear();
        patch({ starting: false });
      }
    };
    const off = product.terminals.onExit((sessionId, code) => {
      if (!session || session.id !== sessionId) {
        if (starting) {
          if (earlyExits.size >= 64) earlyExits.delete(earlyExits.keys().next().value!);
          earlyExits.set(sessionId, code);
        }
        return;
      }
      session = { ...session, status: 'exited', exitCode: code };
      patch({ session });
      clearTimeout(timer);
      // An older in-flight probe may predate the successful login. Recheck after it settles.
      void (pending ?? Promise.resolve()).then(check);
    });
    actions.current = { check, start, cancel };
    setState(initial);
    void check();
    return () => {
      disposed = true;
      operation++;
      actions.current = null;
      abort.abort();
      clearTimeout(timer);
      off();
      if (session) void stop(session).catch(() => {});
    };
  }, [providerId, hostId]);
  return {
    ...state,
    check: useCallback(() => actions.current?.check(), []),
    start: useCallback(() => actions.current?.start(), []),
    cancel: useCallback(() => actions.current?.cancel(), []),
  };
}
