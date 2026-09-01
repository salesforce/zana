import type { SessionMetadataSnapshot, SessionMetadataValue } from '@zana-ai/zcc-domain/product';
import type { ExecutionResolution, ModelResolution, RoleResolution } from './target-resolution.js';
import type { LaunchProvider } from './launch-provider.js';

const MAX_VALUE_LENGTH = 256;

function value(label: string, raw: string | undefined): SessionMetadataValue {
  return { label, ...(raw ? { value: raw.slice(0, MAX_VALUE_LENGTH) } : {}) };
}

/**
 * Build the initial generic metadata section from trusted launch resolution.
 * Provider-owned runtime collectors can append safe sections after launch.
 */
export type LaunchMetadataAxis = 'provider' | 'model' | 'role' | 'execution';

export function launchMetadataSnapshot(input: {
  provider: LaunchProvider;
  model: ModelResolution;
  role: RoleResolution;
  execution: ExecutionResolution;
  observedAt: number;
  axes: readonly LaunchMetadataAxis[];
}): SessionMetadataSnapshot {
  const targets = input.provider.adapter.descriptor.targets;
  const model = targets?.models.find((candidate) => candidate.id === input.model.targetId);
  const providers = targets?.providers;
  const provider = providers?.find((candidate) => candidate.id === (input.model.providerTargetId ?? model?.provider))
    // A fixed-provider harness has one trusted provider even when its CLI owns
    // the model default, so retain that fact without guessing a model.
    ?? (targets?.providerModelRelationship === 'fixed-provider' && providers?.length === 1
      ? providers[0]
      : undefined);
  const role = targets?.roles.find((candidate) => candidate.id === input.role.targetId);
  const execution = input.execution.targetId
    ? targets?.executionTargets?.find((candidate) => candidate.id === input.execution.targetId)?.effect
      ?? input.execution.state
    : input.execution.state;

  const values: SessionMetadataValue[] = [];
  if (input.axes.includes('provider') && provider?.label) values.push(value('Provider', provider.label));
  if (input.axes.includes('model') && model?.label) values.push(value('Model', model.label));
  if (input.axes.includes('role') && role?.label) values.push(value('Role', role.label));
  if (input.axes.includes('execution') && execution) values.push(value('Execution', execution));

  return {
    observedAt: input.observedAt,
    sections: values.length ? [{
      id: 'runtime',
      label: 'Runtime',
      values
    }] : []
  };
}
