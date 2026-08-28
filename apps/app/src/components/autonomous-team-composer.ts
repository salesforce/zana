/** Keep the current team when it is still listed; otherwise pick the first. */
export function defaultAutonomousTeamId(
  teams: readonly { id: string }[],
  currentId: string
): string {
  if (currentId && teams.some((team) => team.id === currentId)) return currentId;
  return teams[0]?.id ?? '';
}
