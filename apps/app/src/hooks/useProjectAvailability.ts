import { useEffect, useState } from 'react';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import { readProjectAvailability, type ProjectAvailability } from '../lib/machine-project-client.js';
import { subscribeProductReconnect, subscribeProductEvent } from '../lib/product-ws.js';

/** Host status changes and reconnects invalidate facts; failures never remove projects. */
export function useProjectAvailability(projects: readonly Project[], hosts: readonly Host[], refreshToken = 0) {
  const [statuses, setStatuses] = useState<Record<string, ProjectAvailability>>({});
  const projectKey = JSON.stringify(projects.filter(p => !p.quickAgent).map(p => [p.id, p.hostId, p.path]));
  const hostKey = JSON.stringify(hosts.map(h => [h.id, h.status]));
  useEffect(() => {
    let cancelled = false, generation = 0;
    const ids = (JSON.parse(projectKey) as string[][]).map(row => row[0]);
    const refresh = async () => {
      const current = ++generation;
      setStatuses({});
      try {
        const result = await readProjectAvailability(ids);
        if (!cancelled && current === generation) setStatuses(result);
      } catch { /* A disconnected product server is not proof of a missing folder. */ }
    };
    void refresh();
    const stop = subscribeProductReconnect(refresh);
    const stopSync = subscribeProductEvent<{ status: string }>('projects:sync', event => { if (event.status === 'synced') void refresh(); });
    return () => { cancelled = true; stop(); stopSync(); };
  }, [projectKey, hostKey, refreshToken]);
  return statuses;
}
