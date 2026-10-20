/** Agents the Studio opened lately, newest first, for the Salesforce hub. Local to this renderer. */
export interface RecentAgent { projectId: string; path: string; openedAt: number }

const KEY = 'salesforce:recent-agents';
export const RECENT_AGENT_LIMIT = 8;

const valid = (row: unknown): row is RecentAgent => {
  if (!row || typeof row !== 'object') return false;
  const { projectId, path, openedAt } = row as Record<string, unknown>;
  return typeof projectId === 'string' && projectId.length > 0 && projectId.length <= 200
    && typeof path === 'string' && path.length > 0 && path.length <= 500
    && typeof openedAt === 'number' && Number.isFinite(openedAt);
};

/** Storage is untrusted: malformed rows are dropped, never repaired. */
export function readRecentAgents(): RecentAgent[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(valid).slice(0, RECENT_AGENT_LIMIT) : [];
  } catch { return []; }
}

export function recordRecentAgent(projectId: string, path: string, now = Date.now()): void {
  if (!valid({ projectId, path, openedAt: now })) return;
  const rest = readRecentAgents().filter(row => row.projectId !== projectId || row.path !== path);
  try { localStorage.setItem(KEY, JSON.stringify([{ projectId, path, openedAt: now }, ...rest].slice(0, RECENT_AGENT_LIMIT))); }
  catch { /* optional */ }
}
