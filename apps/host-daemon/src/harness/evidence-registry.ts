import type { ExecutionState, HarnessExecutionTarget, HarnessExecutionRisk } from '@zana-ai/zcc-domain/harness-adapter';
import type { LaunchProvider } from './launch-provider.js';
import type { ExecutionEvidenceFixture } from './execution-evidence.js';

const STATES: readonly ExecutionState[] = ['plan', 'interactive', 'accept-edits', 'autonomous'];

const RISK: Readonly<Record<ExecutionState, HarnessExecutionRisk>> = {
  plan: 'low',
  interactive: 'medium',
  'accept-edits': 'high',
  autonomous: 'critical'
};

const openCodeExecutionEvidence = (
  state: ExecutionState,
  observed: ExecutionEvidenceFixture['observed']
): ExecutionEvidenceFixture => ({
  id: `opencode.execution.${state}`,
  version: 1,
  status: 'approved',
  cliVersion: '1.18.0',
  scopes: ['local'],
  probe: 'opencode --version; opencode --help; opencode run --help; opencode agent list',
  environmentAssumptions: ['local registered project', 'OpenCode built-in plan and build agents'],
  observed,
  reviewedAt: '2026-08-04',
  adapterOwnerApproval: 'ZCC harness execution approval'
});

const exactExecutionEvidence = (
  adapterId: 'claude' | 'cursor' | 'codex',
  state: ExecutionState,
  cliVersion: string,
  scopes: readonly ('local' | 'remote')[],
  observed: ExecutionEvidenceFixture['observed']
): ExecutionEvidenceFixture => ({
  id: `${adapterId}.execution.${state}`,
  version: 1,
  status: 'approved',
  cliVersion,
  scopes,
  probe: `${adapterId} --version plus provider and golden argv contract suite`,
  environmentAssumptions: ['registered project', 'adapter-owned native execution contribution'],
  observed,
  reviewedAt: '2026-08-04',
  adapterOwnerApproval: 'ZCC harness execution approval'
});

const exactObserved = (effect: string): ExecutionEvidenceFixture['observed'] => ({
  filesystem: effect,
  commands: effect,
  network: 'native adapter policy retained',
  approvalPrompts: 'native adapter policy retained',
  explicitDenialsRetained: true
});

/** Release-reviewed production execution evidence. Unlisted targets stay candidate. */
const APPROVED_EXECUTION_EVIDENCE: Readonly<Record<string, ExecutionEvidenceFixture>> = Object.freeze({
  ...Object.fromEntries((['plan', 'interactive', 'accept-edits', 'autonomous'] as const).map((state) => [
    `claude.execution.${state}`,
    exactExecutionEvidence('claude', state, '2.1.220', ['local', 'remote'], exactObserved(`Claude ${state} permission mode`))
  ])),
  ...Object.fromEntries((['plan', 'interactive', 'accept-edits', 'autonomous'] as const).map((state) => [
    `codex.execution.${state}`,
    exactExecutionEvidence('codex', state, '0.140.0', ['local', 'remote'], exactObserved(`Codex ${state} sandbox and approval tuple`))
  ])),
  'cursor.execution.plan': exactExecutionEvidence('cursor', 'plan', '2026.01.23', ['local'], exactObserved('Cursor plan mode')),
  'cursor.execution.interactive': exactExecutionEvidence('cursor', 'interactive', '2026.01.23', ['local'], exactObserved('Cursor native configured policy')),
  'cursor.execution.accept-edits': exactExecutionEvidence('cursor', 'accept-edits', '2026.01.23', ['local'], {
    ...exactObserved('Cursor force mode'), approvalPrompts: 'broader than portable accept-edits; interactive consent required'
  }),
  'cursor.execution.autonomous': exactExecutionEvidence('cursor', 'autonomous', '2026.01.23', ['local'], exactObserved('Cursor force mode')),
  'opencode.execution.plan': openCodeExecutionEvidence('plan', {
    filesystem: 'built-in plan agent denies edit tools',
    commands: 'built-in plan agent denies shell execution',
    network: 'no autonomous network permission added',
    approvalPrompts: 'not applicable because mutating tools are denied',
    explicitDenialsRetained: true
  }),
  'opencode.execution.interactive': openCodeExecutionEvidence('interactive', {
    filesystem: 'native configured policy remains authoritative',
    commands: 'native configured policy remains authoritative',
    network: 'native configured policy remains authoritative',
    approvalPrompts: 'native configured policy remains authoritative',
    explicitDenialsRetained: true
  }),
  'opencode.execution.accept-edits': openCodeExecutionEvidence('accept-edits', {
    filesystem: 'build agent with --auto approves edits',
    commands: '--auto also approves commands not explicitly denied',
    network: '--auto also approves network-capable tools not explicitly denied',
    approvalPrompts: 'broader than portable accept-edits; interactive consent required',
    explicitDenialsRetained: true
  }),
  'opencode.execution.autonomous': openCodeExecutionEvidence('autonomous', {
    filesystem: 'build agent with --auto approves allowed edits',
    commands: '--auto approves commands not explicitly denied',
    network: '--auto approves network-capable tools not explicitly denied',
    approvalPrompts: 'no prompt for permissions not explicitly denied',
    explicitDenialsRetained: true
  })
});

export function executionEvidenceFor(targetId: string): ExecutionEvidenceFixture | undefined {
  return APPROVED_EXECUTION_EVIDENCE[targetId];
}

export function executionTargetsFor(provider: LaunchProvider): readonly HarnessExecutionTarget[] {
  const descriptor = provider.adapter.descriptor;
  const mapping = descriptor.targets?.executionStateMapping;
  if (!mapping) return [];
  const postures = descriptor.profiles
    .map(({ posture }) => posture)
    .filter((posture) => posture !== 'unrestricted');
  return STATES.flatMap((state) => {
    const effect = mapping[state];
    if (!effect) return [];
    const metadata = provider.adapter.executionTargetMetadata?.[state];
    if (!metadata) return [];
    const id = `${descriptor.id}.execution.${state}`;
    const productionEvidence = executionEvidenceFor(id);
    return [{
      id,
      state,
      equivalence: metadata.equivalence,
      effect,
      materialDifference: metadata.equivalence === 'closest'
        ? 'Native policy may approve a broader operation set than portable intent.'
        : 'None',
      risk: RISK[state],
      evidence: { id, version: 1 },
      evidenceStatus: productionEvidence?.status ?? 'candidate',
      scopes: metadata.scopes,
      profilePostures: [...new Set(postures)],
      unattendedAllowed: state !== 'accept-edits',
      consent: state === 'plan' ? 'none' as const : 'required' as const
    }];
  });
}

export function executionTargetFor(provider: LaunchProvider, targetId: ExecutionState | string) {
  const stableId = STATES.includes(targetId as ExecutionState)
    ? `${provider.adapter.descriptor.id}.execution.${targetId}`
    : targetId;
  return executionTargetsFor(provider).find((target) => target.id === stableId);
}

export function validateExecutionTargetCatalogs(providers: readonly LaunchProvider[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const provider of providers) {
    const mapping = provider.adapter.descriptor.targets?.executionStateMapping ?? {};
    const targets = executionTargetsFor(provider);
    for (const state of STATES) {
      const target = targets.find((candidate) => candidate.state === state);
      if (!!mapping[state] !== !!target) errors.push(`${provider.adapter.descriptor.id}:${state}: mapping/target mismatch`);
      if (target) {
        if (ids.has(target.id)) errors.push(`${target.id}: duplicate target id`);
        ids.add(target.id);
        if (target.effect !== mapping[state]) errors.push(`${target.id}: effect mismatch`);
      }
    }
  }
  return errors;
}
