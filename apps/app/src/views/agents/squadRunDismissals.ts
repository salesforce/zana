const STORAGE_KEY = 'zcc.squadRunDismissals.v1';
const MAX_DISMISSALS = 250;

type Dismissal = [projectId: string, executionId: string];

function readDismissals(): Dismissal[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is Dismissal => Array.isArray(item) && item.length === 2
      && item.every((value) => typeof value === 'string' && value.length > 0)).slice(-MAX_DISMISSALS);
  } catch {
    return [];
  }
}

export function readDismissedSquadRuns(projectId: string | undefined): Set<string> {
  return new Set(readDismissals().filter(([id]) => id === projectId).map(([, executionId]) => executionId));
}

export function saveSquadRunDismissal(projectId: string, executionId: string, dismissed: boolean): void {
  const next = readDismissals().filter(([project, run]) => project !== projectId || run !== executionId);
  if (dismissed) next.push([projectId, executionId]);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(-MAX_DISMISSALS)));
  } catch {
    // The view can still hide and restore rows for the current visit.
  }
}

export function subscribeToSquadRunDismissals(onChange: () => void): () => void {
  const handleChange = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener('storage', handleChange);
  return () => window.removeEventListener('storage', handleChange);
}
