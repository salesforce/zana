import { useCallback, useEffect, useState } from 'react';
import type {
  ProviderCliInstallActionKind,
  ProviderCliKey,
  ProviderCliStatus,
  ProviderCliStatusResponse
} from '@zana-ai/zcc-contracts/host-rpc';
import { product } from '../../lib/product-client.js';
import {
  installProviderCliOnMachine,
  providerCliKeyForProviderId
} from '../../views/settings/machine-provider-clis.js';
import { isBlockingProviderCliStatus } from './ProviderCliBanner.js';

export type ComposerProviderCliState = {
  status: ProviderCliStatus | null;
  providerKey: ProviderCliKey | null;
  blocked: boolean;
  busy: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  runInstall: () => Promise<void>;
};

export function useComposerProviderCli(input: {
  enabled: boolean;
  hostId: string | undefined;
  providerId: string | undefined;
}): ComposerProviderCliState {
  const providerKey = input.providerId
    ? providerCliKeyForProviderId(input.providerId)
    : null;
  const [inventory, setInventory] = useState<ProviderCliStatusResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!input.enabled || !input.hostId) {
      setInventory(null);
      return;
    }
    try {
      const next = await product.hosts.providerCliStatus(input.hostId);
      setInventory(next);
      setError(null);
    } catch (err) {
      setInventory(null);
      setError(err instanceof Error ? err.message : 'Could not check provider CLI status');
    }
  }, [input.enabled, input.hostId]);

  useEffect(() => {
    void refresh();
  }, [refresh, providerKey]);

  const status = providerKey && inventory ? inventory[providerKey] ?? null : null;
  const blocked = isBlockingProviderCliStatus(status);

  const runInstall = useCallback(async () => {
    if (!input.hostId || !providerKey || !status?.installAction || busy) return;
    const actionKind: ProviderCliInstallActionKind = status.installAction.kind;
    setBusy(true);
    setError(null);
    try {
      const outcome = await installProviderCliOnMachine({
        hostId: input.hostId,
        provider: providerKey,
        actionKind,
        install: product.hosts.installProviderCli
      });
      if (!outcome.ok) {
        setError(outcome.message);
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [busy, input.hostId, providerKey, refresh, status?.installAction]);

  return {
    status,
    providerKey,
    blocked,
    busy,
    error,
    refresh,
    runInstall
  };
}
