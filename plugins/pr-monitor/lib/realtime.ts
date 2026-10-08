export const PRS_CHANGED_CHANNEL = 'prs-changed';

/** Agent → open panel view requests (filter the board, open a PR's details). */
export const PANEL_UI_CHANNEL = 'panel-ui';

export type PrPanelUiAction =
  | { action: 'filter'; repos: string[]; query: string }
  | { action: 'reveal'; url: string };

export function parsePanelUiAction(payload: unknown): PrPanelUiAction | null {
  if (!payload || typeof payload !== 'object') return null;
  const rec = payload as Record<string, unknown>;
  if (rec.action === 'reveal' && typeof rec.url === 'string' && rec.url) return { action: 'reveal', url: rec.url };
  if (rec.action === 'filter') {
    const repos = Array.isArray(rec.repos) ? rec.repos.filter((repo): repo is string => typeof repo === 'string') : [];
    return { action: 'filter', repos, query: typeof rec.query === 'string' ? rec.query : '' };
  }
  return null;
}
