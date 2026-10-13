import type { InboxInput } from '@zana-ai/zcc-server/services/inbox/inbox-store';

/** Structured discriminator the renderer reads instead of sniffing notice prose. */
export const SQUAD_WORKTREE_NOTICE = 'worktree-lifecycle' as const;

type NoticeInput = Pick<InboxInput, 'projectId' | 'projectLabel' | 'subject' | 'comments' | 'executionId' | 'dedupeKey' | 'origin'>;

/**
 * Stamp a host-authored Squad worktree notice. Only main calls this; the
 * renderer treats the stamp as presentation routing, never as authorization.
 */
export function squadWorktreeNotice<T extends NoticeInput>(input: T): T & { squadNotice: typeof SQUAD_WORKTREE_NOTICE } {
  return { ...input, squadNotice: SQUAD_WORKTREE_NOTICE };
}

export function squadWorktreeUnavailableNotice(
  project: { id: string; name?: string },
  executionId: string,
  reason: string
): InboxInput {
  return squadWorktreeNotice({
    projectId: project.id,
    projectLabel: project.name,
    subject: 'Squad worktree unavailable',
    comments: `Squad run uses project root because shared worktree creation failed: ${reason}`,
    executionId,
    dedupeKey: `squad-worktree-fallback:${executionId}`
  });
}

export function squadWorktreeRetainedNotice(args: {
  projectId: string;
  projectLabel?: string;
  executionId: string;
  stateVersion: number;
  jobTitle?: string;
  state: string;
  worktreePath: string;
}): InboxInput {
  return squadWorktreeNotice({
    projectId: args.projectId,
    projectLabel: args.projectLabel,
    executionId: args.executionId,
    subject: 'Squad worktree retained',
    origin: { title: args.jobTitle },
    comments: `Execution ${args.state.toLowerCase()}. The shared worktree remains at \`${args.worktreePath}\`. Open Squad details to inspect recovery options and manage the retained worktree.`,
    dedupeKey: `squad-worktree-retained:${args.executionId}:${args.stateVersion}`
  });
}
