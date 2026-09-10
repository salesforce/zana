import { useEffect, useState } from 'react';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import { product } from '../lib/product-client.js';

/** Last roster from a successful (or empty) fetch — survives composer remounts. */
let cachedHosts: Host[] = [];

function rememberHosts(rows: Host[]): Host[] {
  cachedHosts = rows;
  return rows;
}

/** Test hook: drop the remount cache so specs start from an empty roster. */
export function resetHostsCache(): void {
  cachedHosts = [];
}

export function useHosts(): Host[] {
  const [hosts, setHosts] = useState<Host[]>(() => cachedHosts);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      product.hosts.list().then((rows) => {
        if (!cancelled) setHosts(rememberHosts(Array.isArray(rows) ? rows : []));
      }).catch(() => {
        if (!cancelled) setHosts(rememberHosts([]));
      });
    };
    refresh();
    const unsub = product.hosts.onChanged((payload) => {
      if (cancelled) return;
      if (Array.isArray(payload)) {
        setHosts(rememberHosts(payload));
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
  if (project?.remote) {
    if (project.hostId && hosts.some((host) => host.id === project.hostId)) return project.hostId;
    return undefined;
  }
  if (project?.hostId && hosts.some((host) => host.id === project.hostId)) return project.hostId;
  return primaryHost(hosts)?.id;
}
