import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { product } from '../../../lib/product-client.js';
import { createSecondaryPanelCommands } from './threadSecondaryPanelLogic.js';
import {
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
  options?: { defaultOpen?: boolean; syncServer?: boolean }
) {
  const defaultOpen = options?.defaultOpen === true;
  const syncServer = options?.syncServer === true;
  const [state, setState] = useState<ThreadSecondaryPanelState>(() => (
    restoreSecondaryPanel(ownerId, { defaultOpen })
  ));
  const [serverHydrated, setServerHydrated] = useState(() => !syncServer);
  const revisionRef = useRef(0);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ownerId) return;
    const next = restoreSecondaryPanel(ownerId, { defaultOpen });
    setState((current) => (secondaryPanelStatesEqual(current, next) ? current : next));
  }, [defaultOpen, ownerId]);

  useEffect(() => {
    if (!syncServer || !ownerId) {
      setServerHydrated(true);
      return;
    }
    let cancelled = false;
    const hydrate = async () => {
      if (hasStoredSecondaryPanel(ownerId)) {
        if (!cancelled) setServerHydrated(true);
        return;
      }
      try {
        const body = await product.threads.tabs(ownerId) as ThreadTabsResponse;
        if (cancelled) return;
        revisionRef.current = revisionFromTabsResponse(body);
        if (body.tabs.length > 0) {
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
    persistTimer.current = setTimeout(() => {
      const expectedRevision = revisionRef.current;
      void product.threads.updateTabs(ownerId, tabsPutBody(state, expectedRevision)).then((body) => {
        revisionRef.current = revisionFromTabsResponse(body as ThreadTabsResponse);
      }).catch(() => undefined);
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
      setState((current) => applyContractTabs(current, payload.tabs));
    });
  }, [ownerId, syncServer]);

  const update = useCallback((recipe: (current: ThreadSecondaryPanelState) => ThreadSecondaryPanelState) => {
    setState((current) => recipe(current));
  }, []);

  const commands = useMemo(() => createSecondaryPanelCommands(update), [update]);
  return useMemo(() => ({ state, ...commands }), [commands, state]);
}

export function useThreadSecondaryPanel(threadId: string | undefined) {
  return useSecondaryPanel(threadId, { syncServer: true });
}
