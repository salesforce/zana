import type { SpawnEnvironmentChoice } from '@zana-ai/zcc-domain';
import type { Project } from '@zana-ai/zcc-domain/product';

export const HOST_WORKSPACE_MISMATCH = 'host-workspace-mismatch';

export type SpawnChoiceForHost =
  | { ok: true; choice: SpawnEnvironmentChoice; dropCwd: boolean }
  | { ok: false; code: typeof HOST_WORKSPACE_MISMATCH; message: string };

const FOREIGN_PROJECT_MESSAGE =
  'This project’s folder is not on the selected machine. Add a folder on that machine, or pick the host this project lives on.';

/**
 * Local checkouts are host-specific. Default Project on another machine
 * becomes a personal scratch there; any other local folder is refused.
 * SSH remotes keep their own proxy / remotePath handling.
 */
export function resolveSpawnChoiceForHost(args: {
  project: Pick<Project, 'hostId' | 'quickAgent' | 'remote'>;
  choice: SpawnEnvironmentChoice;
  executionHostId: string;
  primaryHostId: string | undefined;
  remoteToolProxy: boolean;
}): SpawnChoiceForHost {
  if (args.remoteToolProxy || args.project.remote) {
    return { ok: true, choice: args.choice, dropCwd: false };
  }
  const boundHostId = args.project.hostId ?? args.primaryHostId;
  if (!boundHostId || boundHostId === args.executionHostId) {
    return { ok: true, choice: args.choice, dropCwd: false };
  }
  if (args.project.quickAgent) {
    return { ok: true, choice: { kind: 'personal' }, dropCwd: true };
  }
  return { ok: false, code: HOST_WORKSPACE_MISMATCH, message: FOREIGN_PROJECT_MESSAGE };
}
