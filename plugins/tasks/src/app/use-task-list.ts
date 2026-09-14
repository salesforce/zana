import { useCallback, useEffect, useState } from 'react';
import { useRealtime, useRpc } from '@zana-ai/zcc-plugin-sdk/app';
import { TASKS_CHANGED, type PublicTask } from '../model.js';

export function useTaskList() {
  const rpc = useRpc();
  const [items, setItems] = useState<PublicTask[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    return rpc
      .call('list')
      .then((result) => {
        const row = result as { items?: PublicTask[] };
        setItems(Array.isArray(row?.items) ? row.items : []);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        setItems((current) => current ?? []);
      });
  }, [rpc]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useRealtime(TASKS_CHANGED, refresh);

  return { items, error, refresh, rpc };
}
