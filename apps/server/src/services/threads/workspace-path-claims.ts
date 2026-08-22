import {
  findForeignManagedEnvironmentAtHostPath,
  findProjectEnvironmentByHostPath,
  hasLiveThreadAtHostPath,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import { isZccManagedWorkspacePath } from './worktree-paths.js';

export interface UnmanagedAttachRefusal {
  reason: 'foreign-managed' | 'live-thread';
  message: string;
}

export function unmanagedAttachRefusal(
  db: ZccDatabase,
  args: {
    dataDir: string | null;
    checksOutBranch: boolean;
    hostId: string;
    path: string;
    projectId: string;
  }
): UnmanagedAttachRefusal | null {
  const foreignManagedMessage = 'Workspace path is a managed workspace owned by another project';
  if (findForeignManagedEnvironmentAtHostPath(db, {
    hostId: args.hostId,
    path: args.path,
    projectId: args.projectId
  })) {
    return { reason: 'foreign-managed', message: foreignManagedMessage };
  }
  if (
    args.dataDir !== null
    && isZccManagedWorkspacePath({ dataDir: args.dataDir, path: args.path })
    && !findProjectEnvironmentByHostPath(db, args.projectId, args.hostId, args.path)
  ) {
    return { reason: 'foreign-managed', message: foreignManagedMessage };
  }
  if (args.checksOutBranch && hasLiveThreadAtHostPath(db, { hostId: args.hostId, path: args.path })) {
    return {
      reason: 'live-thread',
      message: 'Cannot checkout branch while another thread is using this workspace'
    };
  }
  return null;
}
