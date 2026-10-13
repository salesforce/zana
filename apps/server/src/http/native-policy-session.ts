import type { ProductHttpContext } from './product-context.js';
import { asControlResult } from './cli-agent-ops.js';

/** Resolve shell and native CLI identities through their authoritative owners. */
export async function nativePolicySession(ctx: ProductHttpContext, id: string): Promise<{
  id: string; projectId: string; profile: string;
} | null> {
  const shell = ctx.terminalSessions.get(id);
  if (shell) return shell.status === 'exited' ? null : shell;
  if (!ctx.cliAgentOps) return null;
  try {
    const result = asControlResult<unknown>(await ctx.cliAgentOps.get(id));
    if (!result.ok || !result.value || typeof result.value !== 'object' || Array.isArray(result.value)) return null;
    const session = result.value as Record<string, unknown>;
    if (session.id !== id || typeof session.projectId !== 'string' || !session.projectId
      || typeof session.profile !== 'string' || !session.profile || session.status !== 'running') return null;
    return { id, projectId: session.projectId, profile: session.profile };
  } catch {
    return null;
  }
}
