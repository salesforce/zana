import type { FsMutateResult, Result, ScheduledTask } from '@zana-ai/zcc-domain/product';
import { readClaudeLoops } from '@zana-ai/zcc-server/services/misc/claude-loops-store';
import { gitCommonDir } from '@zana-ai/zcc-server/services/projects/git';
import { store } from '@zana-ai/zcc-server/services/projects/store';
import { verifyHarnesses } from '@zana-ai/zcc-host-daemon/harness/harness-verify';
import { ctx } from './ctx.js';
import { realpathSync } from 'node:fs';

export const harnessVerifyState: {
  cache:
    | { expiresAt: number; result: Promise<Awaited<ReturnType<typeof verifyHarnesses>>> }
    | undefined;
} = { cache: undefined };

/** Renderer-supplied FS roots must realpath-match a registered project (Rule 2). */
export async function trustedProjectRoot(root: string): Promise<string | null> {
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return null;
  }
  const projects = store.listProjects();
  for (const p of projects) {
    try {
      if (realpathSync(p.path) === realRoot) return realRoot;
    } catch {
      /* project dir gone / unreadable — skip */
    }
  }
  const rootCommon = await gitCommonDir(realRoot);
  if (!rootCommon) return null;
  for (const p of projects) {
    const projCommon = await gitCommonDir(p.path);
    if (projCommon && projCommon === rootCommon) return realRoot;
  }
  return null;
}

export function rejectRoot(): FsMutateResult {
  return { ok: false, message: 'Path is not inside a known project' };
}

export function listSchedulesForUi(): ScheduledTask[] {
  return [
    ...ctx.scheduler.list(),
    ...readClaudeLoops(store.listProjects(), new Date().toISOString())
  ];
}

export function isExternalId(id: string): boolean {
  return id.startsWith('claude-loop:');
}

export function externalReject(): Result<never> {
  return {
    ok: false,
    code: 'READ_ONLY',
    message: 'This is a Claude /loop job — manage it from Claude Code, not here.'
  };
}
