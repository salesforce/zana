import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { product } from '../../../lib/product-client.js';
import { createSecondaryPanelCommands } from './threadSecondaryPanelLogic.js';
import {
  applySecondaryPanelOpenWidth,
  hasStoredSecondaryPanel,
  persistSecondaryPanel,
  restoreSecondaryPanel,
  secondaryPanelStatesEqual,
  type ThreadSecondaryPanelState
} from './threadSecondaryPanelState.js';
import {
  applyContractTabs,
  revisionFromTabsResponse,
  tabsPutBody
} from './threadTabsContract.js';
import type { ThreadTab, ThreadTabsResponse } from '@zana-ai/zcc-server-contract';

const TABS_PUT_DEBOUNCE_MS = 300;

function isThreadTabsPayload(payload: unknown): payload is {
  threadId: string;
  revision: number;
  tabs: ThreadTab[];
} {
  if (!payload || typeof payload !== 'object') return false;
  const row = payload as Record<string, unknown>;
  return typeof row.threadId === 'string' && typeof row.revision === 'number' && Array.isArray(row.tabs);
}

export function useSecondaryPanel(
  ownerId: string | undefined,
  options?: {
    defaultOpen?: boolean;
    syncServer?: boolean;
    modal?: boolean;
    getContainerWidthPx?: () => number;
  }
) {
  const defaultOpen = options?.defaultOpen === true;
  const syncServer = options?.syncServer === true;
  const layoutRef = useRef({
    modal: options?.modal === true,
    getContainerWidthPx: options?.getContainerWidthPx
  });
  layoutRef.current = {
    modal: options?.modal === true,
    getContainerWidthPx: options?.getContainerWidthPx
  };
  const [state, setState] = useState<ThreadSecondaryPanelState>(() => (
    restoreSecondaryPanel(ownerId, { defaultOpen })
  ));
  const [serverHydrated, setServerHydrated] = useState(() => !syncServer);
  const revisionRef = useRef(0);
  const localVersionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const savingRef = useRef(false);
  const pendingSaveRef = useRef<{
    owner: { id: string | undefined };
    state: ThreadSecondaryPanelState;
    version: number;
  } | null>(null);
  const ownerRef = useRef({ id: ownerId });
  if (ownerRef.current.id !== ownerId) ownerRef.current = { id: ownerId };
  const mountedRef = useRef(true);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pendingSaveRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ownerId) return;
    revisionRef.current = 0;
    localVersionRef.current = 0;
    savedVersionRef.current = 0;
    const next = restoreSecondaryPanel(ownerId, { defaultOpen });
    setState((current) => (secondaryPanelStatesEqual(current, next) ? current : next));
  }, [defaultOpen, ownerId]);

  useEffect(() => {
    if (!syncServer || !ownerId) {
      setServerHydrated(true);
      return;
    }
    let cancelled = false;
    const initialVersion = localVersionRef.current;
    const hydrate = async () => {
      if (hasStoredSecondaryPanel(ownerId)) {
        if (!cancelled) setServerHydrated(true);
        return;
      }
      try {
        const body = await product.threads.tabs(ownerId) as ThreadTabsResponse;
        if (cancelled) return;
        revisionRef.current = revisionFromTabsResponse(body);
        if (body.tabs.length > 0 && localVersionRef.current === initialVersion) {
          setState((current) => applyContractTabs(current, body.tabs));
        }
      } catch {
        /* stay local */
      } finally {
        if (!cancelled) setServerHydrated(true);
      }
    };
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [ownerId, syncServer]);

  useEffect(() => {
    if (!ownerId) return;
    if (syncServer && !serverHydrated) return;
    persistSecondaryPanel(ownerId, state);
    if (!syncServer) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    const version = localVersionRef.current;
    const owner = ownerRef.current;
    persistTimer.current = setTimeout(() => {
      // Serialize saves, retaining only the latest pending snapshot, so a newer
      // snapshot uses the preceding save's revision without an unbounded queue.
      // Its SSE echo may arrive before the HTTP response; neither may replace
      // local tabs opened since that snapshot was captured.
      pendingSaveRef.current = { owner, state, version };
      if (savingRef.current) return;
      savingRef.current = true;
      void (async () => {
        try {
          while (pendingSaveRef.current) {
            const pending = pendingSaveRef.current;
            pendingSaveRef.current = null;
            if (!mountedRef.current || ownerRef.current !== pending.owner || !pending.owner.id) continue;
            try {
              const body = await product.threads.updateTabs(pending.owner.id, tabsPutBody(pending.state, revisionRef.current));
              if (!mountedRef.current || ownerRef.current !== pending.owner) continue;
              revisionRef.current = Math.max(revisionRef.current, revisionFromTabsResponse(body as ThreadTabsResponse));
              savedVersionRef.current = Math.max(savedVersionRef.current, pending.version);
            } catch { /* retain local state; a later edit retries the save */ }
          }
        } finally { savingRef.current = false; }
      })();
    }, TABS_PUT_DEBOUNCE_MS);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [ownerId, serverHydrated, state, syncServer]);

  useEffect(() => {
    if (!ownerId) return;
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId?: string }>).detail;
      if (detail?.threadId && detail.threadId !== ownerId) return;
      setState((current) => {
        const next = restoreSecondaryPanel(ownerId, { defaultOpen });
        return secondaryPanelStatesEqual(current, next) ? current : next;
      });
    };
    window.addEventListener('zcc:secondary-panel-changed', onChanged);
    return () => window.removeEventListener('zcc:secondary-panel-changed', onChanged);
  }, [defaultOpen, ownerId]);

  useEffect(() => {
    if (!syncServer || !ownerId) return;
    return product.threads.onTabs((payload) => {
      if (!isThreadTabsPayload(payload) || payload.threadId !== ownerId) return;
      if (payload.revision <= revisionRef.current) return;
      revisionRef.current = payload.revision;
      if (localVersionRef.current > savedVersionRef.current) return;
      setState((current) => applyContractTabs(current, payload.tabs));
    });
  }, [ownerId, syncServer]);

  const update = useCallback((recipe: (current: ThreadSecondaryPanelState) => ThreadSecondaryPanelState) => {
    setState((current) => {
      const next = applySecondaryPanelOpenWidth(current, recipe(current), {
        containerWidthPx: layoutRef.current.getContainerWidthPx?.() ?? 0,
        modal: layoutRef.current.modal
      });
      if (!secondaryPanelStatesEqual(current, next)) localVersionRef.current++;
      return next;
    });
  }, []);

  const commands = useMemo(() => createSecondaryPanelCommands(update), [update]);
  return useMemo(() => ({ state, ...commands }), [commands, state]);
}

export function useThreadSecondaryPanel(
  threadId: string | undefined,
  options?: { modal?: boolean; getContainerWidthPx?: () => number }
) {
  return useSecondaryPanel(threadId, { syncServer: true, ...options });
}
