import { useEffect, useState } from 'react';
import { apiJson } from '../lib/fetch-with-app-surface.js';
import { subscribeProductEvent, subscribeProductReconnect } from '../lib/product-ws.js';

export interface MachineProjectSyncStatus {
  hostId: string; status: 'syncing' | 'synced' | 'offline' | 'error'; lastSyncedAt: number | null; error?: string;
}
export function useMachineProjectSync(hostId?: string, connected?: boolean) {
  const [status, setStatus] = useState<MachineProjectSyncStatus | null>(null);
  useEffect(() => {
    let stopped = false, generation = 0;
    setStatus(null);
    if (!hostId) return;
    const refresh = async () => {
      const current = ++generation;
      try {
        const result = await apiJson<MachineProjectSyncStatus>(`/projects/sync-status?hostId=${encodeURIComponent(hostId)}`);
        if (!stopped && generation === current) setStatus(result);
      } catch { /* Keep the last confirmed snapshot during a product outage. */ }
    };
    void refresh();
    const stopEvent = subscribeProductEvent<MachineProjectSyncStatus>('projects:sync', event => {
      if (event.hostId === hostId) { generation++; setStatus(event); }
    });
    const stopReconnect = subscribeProductReconnect(refresh);
    return () => { stopped = true; stopEvent(); stopReconnect(); };
  }, [hostId, connected]);
  return status;
}
