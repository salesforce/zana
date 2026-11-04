import { sortCatalogueByName } from '../lib/catalogue-sort.js';

/**
 * Keep the current team when it is still listed; otherwise pick the flagged default,
 * and with none flagged the first team alphabetically.
 */
export function defaultAutonomousTeamId(
  teams: readonly { id: string; name: string; isDefault?: boolean }[],
  currentId: string
): string {
  if (currentId && teams.some((team) => team.id === currentId)) return currentId;
  const ordered = sortCatalogueByName(teams);
  return (ordered.find((team) => team.isDefault) ?? ordered[0])?.id ?? '';
}
