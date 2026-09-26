import { useState } from 'react';
import { isProjectRailExpanded } from './project-rail.js';

/** Phone browsing never rewrites the desktop's saved session-tree expansion. */
export function useProjectRailDisclosure(
  mobile: boolean,
  saved: Record<string, boolean>,
  save: (id: string, expanded: boolean) => void
) {
  const [local, setLocal] = useState<Record<string, boolean>>({});
  return {
    isExpanded: (id: string, hasSessions: boolean) => mobile
      ? local[id] ?? hasSessions
      : isProjectRailExpanded(saved[id], hasSessions),
    setExpanded: (id: string, expanded: boolean) => {
      if (mobile) setLocal((current) => ({ ...current, [id]: expanded }));
      else save(id, expanded);
    }
  };
}
