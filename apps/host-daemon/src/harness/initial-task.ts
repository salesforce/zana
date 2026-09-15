import { seedPromptArgs } from '@zana-ai/zcc-domain/launch-provider';
import type { LaunchProfileId } from '@zana-ai/zcc-domain/product';
import type { LaunchProvider } from './launch-provider.js';

/**
 * Opening-task bytes that must be typed into the TUI after it is ready.
 * Spawn-arg harnesses already bind the prompt on argv via {@link seedPromptArgs};
 * unsupported transports (shell) stay empty.
 */
export function stdinOpeningPrompt(input: {
  provider: LaunchProvider;
  profile: LaunchProfileId;
  prompt?: string;
  scope: 'local' | 'remote';
  resume?: boolean;
}): string | undefined {
  const body = input.prompt?.trim();
  if (!body || input.resume) return undefined;
  if (seedPromptArgs(input.profile, body).length > 0) return undefined;
  const delivery = input.provider.adapter.descriptor.initialTaskDelivery;
  const transport = input.scope === 'remote' ? delivery.remote : delivery.local;
  return transport === 'stdin-after-ready' ? body : undefined;
}

/** True when this adapter can take a Team / CLI-agent initial task on this scope. */
export function adapterBindsInitialTask(provider: LaunchProvider, scope: 'local' | 'remote'): boolean {
  const delivery = provider.adapter.descriptor.initialTaskDelivery;
  const transport = scope === 'remote' ? delivery.remote : delivery.local;
  if (transport === 'spawn-arg' && delivery.acceptanceSignal === 'argv-bound') return true;
  return transport === 'stdin-after-ready';
}

export function initialTaskDeliveryState(
  provider: LaunchProvider,
  scope: 'local' | 'remote'
): 'bound-at-spawn' | 'delivery-attempted' {
  const delivery = provider.adapter.descriptor.initialTaskDelivery;
  const transport = scope === 'remote' ? delivery.remote : delivery.local;
  return transport === 'spawn-arg' && delivery.acceptanceSignal === 'argv-bound'
    ? 'bound-at-spawn'
    : 'delivery-attempted';
}
