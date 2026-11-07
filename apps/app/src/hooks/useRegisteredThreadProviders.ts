import { useCallback, useEffect, useState } from 'react';
import type { PluginAppEntry } from '@zana-ai/zcc-domain/product';
import { product } from '../lib/product-client.js';

export type RegisteredThreadProvider = Awaited<ReturnType<typeof product.threads.providers>>['providers'][number] & {
  available?: boolean;
  unavailableReason?: string | null;
};

/** Registry ownership, including unavailable declarations, rather than a seeded provider list. */
export function useRegisteredThreadProviders() {
  const [providers, setProviders] = useState<RegisteredThreadProvider[]>([]);
  const [plugins, setPlugins] = useState<PluginAppEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => product.pluginApps.onChanged(refresh), [refresh]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.allSettled([product.threads.providers(), product.pluginApps.list()]).then(([roster, installed]) => {
      if (cancelled) return;
      if (roster.status === 'fulfilled') {
        setProviders(roster.value.providers);
        setError(null);
      } else {
        setError('Could not refresh registered harnesses. Showing the last loaded list.');
      }
      if (installed.status === 'fulfilled') setPlugins(installed.value);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [revision]);

  return { providers, plugins, loading, error, refresh };
}
