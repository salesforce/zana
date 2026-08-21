import type { SshHostEntry, SshSyncResult } from '@zana-ai/zcc-domain/product';

/**
 * Lifecycle-bound registrations for extensions that can supply SSH hosts to the
 * remote-project picker. Core owns picker placement and parsing; an extension
 * only selects itself as the active provider and returns already-structured
 * entries through its own main capability.
 */
export class SshHostProviderRegistry {
  private moduleId: string | null = null;

  register(moduleId: string): void {
    this.moduleId = moduleId;
  }

  clear(moduleId: string): void {
    if (this.moduleId === moduleId) this.moduleId = null;
  }

  activeModuleId(): string | null {
    return this.moduleId;
  }
}

export function asSshHosts(value: unknown): SshHostEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const host = entry as Record<string, unknown>;
    if (typeof host.alias !== 'string' || !host.alias) return [];
    return [{
      alias: host.alias,
      hostname: typeof host.hostname === 'string' ? host.hostname : undefined,
      user: typeof host.user === 'string' ? host.user : undefined,
      proxyJump: typeof host.proxyJump === 'string' ? host.proxyJump : undefined
    }];
  });
}

export function asSshSyncResult(value: unknown): SshSyncResult {
  if (!value || typeof value !== 'object') return { hosts: [] };
  const result = value as Record<string, unknown>;
  return {
    hosts: asSshHosts(result.hosts),
    warning: typeof result.warning === 'string' ? result.warning : undefined
  };
}

/**
 * Preserve the host-owned generic catalogue while allowing an active provider
 * to add or refresh a subset. Alias is the SSH identity used for connection, so
 * it is the stable de-duplication key; provider entries win to retain any newly
 * refreshed HostName/User/ProxyJump fields.
 */
export function mergeSshHosts(generic: SshHostEntry[], provider: SshHostEntry[]): SshHostEntry[] {
  const byAlias = new Map(generic.map((host) => [host.alias, host]));
  for (const host of provider) byAlias.set(host.alias, host);
  return [...byAlias.values()].sort((a, b) => a.alias.localeCompare(b.alias));
}
