import { useEffect, useMemo, useState } from 'react';
import { uninstalledAllowlistSkills } from '@zana-ai/zcc-domain/product';
import { nativeCapabilities } from './native-capabilities.js';

/**
 * Names of installed, enabled skills, or `undefined` while loading / when the
 * inventory is unavailable (advisory warnings then stay silent). Fetched only
 * while `enabled`, via the same listing the Skills view uses.
 */
export function useInstalledSkillNames(enabled: boolean, projectId?: string): string[] | undefined {
  const [names, setNames] = useState<string[] | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void nativeCapabilities({ projectId })
      .then((listing) => {
        if (cancelled) return;
        setNames(
          listing.skills
            .filter((s) => s.kind !== 'rule' && (s as { available?: boolean }).available !== false && (s as { enabled?: boolean }).enabled !== false)
            .map((s) => s.name)
        );
      })
      .catch(() => { if (!cancelled) setNames(undefined); });
    return () => { cancelled = true; };
  }, [enabled, projectId]);
  return names;
}

/** Allowlist entries naming no installed skill. Advisory only: never blocks a save. */
export function useUninstalledSkills(allowlist: readonly string[] | undefined, enabled: boolean, projectId?: string): string[] {
  const installed = useInstalledSkillNames(enabled && !!allowlist?.length, projectId);
  const key = allowlist?.join('\n');
  return useMemo(() => uninstalledAllowlistSkills(allowlist, installed), [key, installed]); // eslint-disable-line react-hooks/exhaustive-deps
}
