import { useEffect, useState } from 'react';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import { product } from '../lib/product-client.js';

export function useHosts(): Host[] {
  const [hosts, setHosts] = useState<Host[]>([]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      product.hosts.list().then((rows) => {
        if (!cancelled) setHosts(Array.isArray(rows) ? rows : []);
      }).catch(() => {
        if (!cancelled) setHosts([]);
      });
    };
    refresh();
    const unsub = product.hosts.onChanged((payload) => {
      if (cancelled) return;
      if (Array.isArray(payload)) {
        setHosts(payload);
        return;
      }
      refresh();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return hosts;
}

export function connectedHosts(hosts: Host[]): Host[] {
  return hosts.filter((host) => host.status === 'connected');
}

export function primaryHost(hosts: Host[]): Host | undefined {
  return hosts.find((host) => host.isPrimary) ?? hosts[0];
}

export function defaultHostId(
  hosts: Host[],
  project?: { hostId?: string; remote?: unknown }
): string | undefined {
  if (project?.remote) return primaryHost(hosts)?.id;
  if (project?.hostId && hosts.some((host) => host.id === project.hostId)) return project.hostId;
  return primaryHost(hosts)?.id;
}
