import { launchDigest } from './digest.js';
import type { LaunchPreflight } from './preflight.js';

/** Exclude activity-only metadata from authorization identity. */
export function projectIdentityDigest(project: unknown): string {
  if (!project || typeof project !== 'object' || Array.isArray(project)) return launchDigest(project);
  const { lastActiveAt: _lastActiveAt, ...identity } = project as Record<string, unknown>;
  return launchDigest(identity);
}

export interface CommitRevalidationState {
  project: unknown;
  storeRevision: string;
  liveCount: number;
  capacity: number;
}

/** Common commit-time checks used by interactive and background launch coordinators. */
export function revalidateLaunchCommit<TRequest, TResolved>(
  plan: LaunchPreflight<TRequest, TResolved>,
  current: CommitRevalidationState
): { ok: true } | { ok: false; reason: string } {
  if (projectIdentityDigest(current.project) !== plan.binding.projectIdentityDigest) {
    return { ok: false, reason: 'project identity changed after preflight' };
  }
  if (current.storeRevision !== plan.binding.storeRevision) {
    return { ok: false, reason: 'launch stores changed after preflight' };
  }
  if (launchDigest(plan.request) !== plan.binding.initialTaskDigest) {
    return { ok: false, reason: 'initial task changed after preflight' };
  }
  if (current.liveCount >= current.capacity) {
    return { ok: false, reason: 'launch capacity changed after preflight' };
  }
  return { ok: true };
}
