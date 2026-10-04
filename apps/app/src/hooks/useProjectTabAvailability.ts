import { useEffect, useState } from 'react';
import { apiJson } from '../lib/fetch-with-app-surface.js';
import type { PluginProjectTabRegistration } from '@zana-ai/zcc-plugin-sdk';

export interface ProjectTabAvailabilityRow {
  available: boolean;
  reason?: string;
}

/**
 * Evaluates every plugin-registered project tab's availability for `projectId`.
 * Keyed by rail id (not `tabId` alone) so callers can look results up by the
 * same id used for the rendered row. A transport failure (network error,
 * non-2xx, timeout) degrades to unavailable with a generic reason — per
 * OBL-006's "errors degrade gracefully" contract a hiccup must disable the
 * tab, not silently grant access as if the evaluator had approved it.
 */
export function useProjectTabAvailability(
  projectId: string,
  tabs: readonly PluginProjectTabRegistration[],
  railIdFor: (tab: PluginProjectTabRegistration) => string
): Record<string, ProjectTabAvailabilityRow> {
  const [rows, setRows] = useState<Record<string, ProjectTabAvailabilityRow>>({});
  const signature = tabs.map((tab) => `${tab.pluginId}:${tab.id}:${tab.generation}`).join(',');

  useEffect(() => {
    let cancelled = false;
    if (tabs.length === 0) {
      setRows({});
      return;
    }
    void Promise.all(
      tabs.map(async (tab) => {
        const railId = railIdFor(tab);
        try {
          const result = await apiJson<ProjectTabAvailabilityRow>(
            `/plugins/${encodeURIComponent(tab.pluginId)}/project-tab-availability`,
            {
              method: 'POST',
              body: JSON.stringify({ tabId: tab.id, projectId })
            }
          );
          return [railId, { available: result.available, ...(result.reason ? { reason: result.reason } : {}) }] as const;
        } catch {
          return [railId, { available: false, reason: 'Could not check availability' }] as const;
        }
      })
    ).then((entries) => {
      if (!cancelled) setRows(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, signature]);

  return rows;
}
