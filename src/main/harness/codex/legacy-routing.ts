import type { HarnessLegacyRoutingAdapter, LegacyExecutionSelection } from '../legacy-routing-adapter.js';

const SANDBOXES = new Set(['read-only', 'workspace-write', 'danger-full-access']);
const APPROVALS = new Set(['untrusted', 'on-request', 'never']);

type Policy = { codexSandbox?: string; codexApproval?: string };

function selection(policy: Policy): LegacyExecutionSelection | undefined {
  if (!policy.codexSandbox && !policy.codexApproval) return undefined;
  if ((policy.codexSandbox && !SANDBOXES.has(policy.codexSandbox)) ||
    (policy.codexApproval && !APPROVALS.has(policy.codexApproval))) {
    return undefined;
  }
  const sandbox = policy.codexSandbox ?? 'default';
  const approval = policy.codexApproval ?? 'default';
  return {
    targetId: `codex.native.${sandbox}+${approval}`,
    contribution: { args: [...(policy.codexSandbox ? ['-s', policy.codexSandbox] : []), ...(policy.codexApproval ? ['-a', policy.codexApproval] : [])] },
    nativePolicy: Object.fromEntries(Object.entries(policy).filter(([, value]) => value !== undefined))
  };
}

function policy(value: unknown): Policy | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => key !== 'codexSandbox' && key !== 'codexApproval')) return undefined;
  if ((candidate.codexSandbox !== undefined && (typeof candidate.codexSandbox !== 'string' || !SANDBOXES.has(candidate.codexSandbox))) ||
    (candidate.codexApproval !== undefined && (typeof candidate.codexApproval !== 'string' || !APPROVALS.has(candidate.codexApproval)))) return undefined;
  return { codexSandbox: candidate.codexSandbox as string | undefined, codexApproval: candidate.codexApproval as string | undefined };
}

export const codexLegacyRouting: HarnessLegacyRoutingAdapter = {
  resolveModel(context, source) {
    if (source === 'global') return undefined;
    const routing = source === 'persona'
      ? context.persona?.harnessRouting?.byAdapter?.codex
      : context.projectSettings?.harnessRouting?.byAdapter?.codex;
    const targetId = routing?.compatibility?.model as string | undefined ??
      (source === 'persona' ? context.persona?.model : context.projectSettings?.model);
    return targetId ? { targetId } : undefined;
  },
  validateCompatibility(value) {
    return policy(value) !== undefined;
  },
  resolveCompatibilityExecution(value) {
    const parsed = policy(value);
    return parsed ? selection(parsed) : undefined;
  },
  resolveExecution(context, source) {
    const parsed: Policy = source === 'persona'
      ? {
          codexSandbox: context.persona?.codexSandbox ?? context.persona?.harnessRouting?.byAdapter?.codex?.compatibility?.codexSandbox,
          codexApproval: context.persona?.codexApproval ?? context.persona?.harnessRouting?.byAdapter?.codex?.compatibility?.codexApproval
        }
      : {
          codexSandbox: context.projectSettings?.codexSandbox,
          codexApproval: context.projectSettings?.codexApproval
        };
    return selection(parsed);
  },
  auditExecution(result) {
    const parsed = policy(result.nativePolicy);
    return parsed ? undefined : 'invalid legacy compatibility execution policy';
  }
};
