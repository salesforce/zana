import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';
import { STUDIO_LIMITS, STUDIO_RPC, type StudioViewState } from '../../../lib/studio-contract.js';

export const VIEW_PUBLISH_DEBOUNCE_MS = 400;
export const SHARE_STORAGE_KEY = 'salesforce:studio:share';

export type StudioViewInput = Omit<StudioViewState, 'share' | 'at'>;

/** Applies the contract's bounds so the server never rejects a publish for size. */
export function buildViewState(input: StudioViewInput, share: boolean, at: number): StudioViewState {
  return {
    ...input,
    selection: input.selection ? { ...input.selection, text: input.selection.text.slice(0, STUDIO_LIMITS.selectionText) } : undefined,
    diagnostics: input.diagnostics.slice(0, STUDIO_LIMITS.diagnostics),
    share, at
  };
}

function readShare(fallback: boolean): boolean {
  try { const raw = localStorage.getItem(SHARE_STORAGE_KEY); return raw === null ? fallback : raw === 'true'; } catch { return fallback; }
}

/**
 * Tracks the share preference and publishes the current view (debounced) so the
 * agent can see it. Returns the state the ContextStrip/AssistantRail display.
 */
export function useStudioView(options: { pluginId: string; projectId?: string | null; threadId?: string | null; input: StudioViewInput; defaultShare?: boolean; debounceMs?: number }) {
  const { pluginId, projectId, threadId, input, defaultShare = true, debounceMs = VIEW_PUBLISH_DEBOUNCE_MS } = options;
  const [share, setShareState] = useState(() => readShare(defaultShare));
  const setShare = useCallback((next: boolean) => {
    setShareState(next);
    try { localStorage.setItem(SHARE_STORAGE_KEY, String(next)); } catch { /* preference is optional */ }
  }, []);
  const signature = JSON.stringify(input);
  const view = useMemo<StudioViewState>(() => buildViewState(JSON.parse(signature) as StudioViewInput, share, Date.now()), [signature, share]);
  const last = useRef('');

  useEffect(() => {
    if (!projectId) return undefined;
    const key = `${projectId}|${threadId ?? ''}|${signature}|${share}`;
    if (key === last.current) return undefined;
    const timer = setTimeout(() => {
      last.current = key;
      // Fire-and-forget: a failed publish only means the agent sees a staler view.
      void Promise.resolve(callPluginRpc(pluginId, STUDIO_RPC.viewPublish, { projectId, ...(threadId ? { threadId } : {}), state: { ...view, at: Date.now() } })).catch(() => undefined);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [pluginId, projectId, threadId, signature, share, view, debounceMs]);

  return { view, share, setShare };
}
