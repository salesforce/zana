import { useEffect, useState } from 'react';
import type { McpServerRef } from '@zana-ai/zcc-domain/product';
import { product } from './product-client.js';

/** A host catalogue server as the allowlist matcher sees it, plus availability. */
export interface McpCatalogueServer extends McpServerRef {
  available: boolean;
  reason?: string;
}

export type McpCatalogueState =
  | { status: 'idle' | 'loading' | 'unavailable' }
  | { status: 'ready'; servers: McpCatalogueServer[]; notes: string[] };

/** Plugin/extension keys end in `:<name>`; user/project keys are the bare name. */
export function catalogueServer(entry: { key: string; source: string; available: boolean; reason?: string }): McpCatalogueServer {
  return {
    key: entry.key,
    source: entry.source,
    name: entry.key.split(':').pop() ?? entry.key,
    available: entry.available,
    ...(entry.reason ? { reason: entry.reason } : {})
  };
}

/**
 * Host MCP catalogue (names, source, availability only). Fetched while `enabled`.
 * A rejected call or a not-ok result is `unavailable`: advisories then stay silent
 * and typed names remain allowed, so the catalogue can never block an edit.
 */
export function useMcpCatalogue(enabled: boolean): McpCatalogueState {
  const [state, setState] = useState<McpCatalogueState>({ status: 'idle' });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((current) => (current.status === 'ready' ? current : { status: 'loading' }));
    void Promise.resolve()
      .then(() => product.mcp.catalogue())
      .then((res) => {
        if (cancelled) return;
        setState(res.ok
          ? { status: 'ready', servers: res.value.entries.map(catalogueServer), notes: res.value.notes }
          : { status: 'unavailable' });
      })
      .catch(() => { if (!cancelled) setState({ status: 'unavailable' }); });
    return () => { cancelled = true; };
  }, [enabled]);
  return state;
}
