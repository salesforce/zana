export interface SquadDetailsTarget {
  projectId: string;
  executionId: string;
}

let pendingTarget: SquadDetailsTarget | null = null;

/** Holds Inbox deep links until Agents board mounts. */
export function setPendingSquadDetailsTarget(target: SquadDetailsTarget): void {
  pendingTarget = target;
}

export function takePendingSquadDetailsTarget(): SquadDetailsTarget | null {
  const target = pendingTarget;
  pendingTarget = null;
  return target;
}
