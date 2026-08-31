import type {
  PluginAgentCardActionContext,
  PluginAgentCardActionRegistration,
  PluginAgentsBoardActionContext,
  PluginAgentsBoardActionRegistration
} from '@zana-ai/zcc-plugin-sdk';

export function describePluginSlotError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function availableAgentCardActions(
  slots: readonly PluginAgentCardActionRegistration[],
  ctx: PluginAgentCardActionContext
): PluginAgentCardActionRegistration[] {
  const visible: PluginAgentCardActionRegistration[] = [];
  for (const slot of slots) {
    if (slot.isAvailable === undefined) {
      visible.push(slot);
      continue;
    }
    try {
      if (slot.isAvailable(ctx)) visible.push(slot);
    } catch (error) {
      console.warn(
        `[plugin:${slot.pluginId}] experimental_agentCardAction "${slot.id}" isAvailable failed: ${describePluginSlotError(error)}`
      );
    }
  }
  return visible;
}

export function invokePluginSlotRun(
  pluginId: string,
  slotId: string,
  kind: string,
  run: () => void | Promise<void>
): void {
  const warn = (error: unknown) => {
    console.warn(`[plugin:${pluginId}] ${kind} "${slotId}" failed: ${describePluginSlotError(error)}`);
  };
  try {
    const result = run();
    if (result instanceof Promise) void result.catch(warn);
  } catch (error) {
    warn(error);
  }
}

export function invokeAgentCardAction(
  slot: PluginAgentCardActionRegistration,
  ctx: PluginAgentCardActionContext
): void {
  invokePluginSlotRun(slot.pluginId, slot.id, 'experimental_agentCardAction', () => slot.run(ctx));
}

export function invokeAgentsBoardAction(
  slot: PluginAgentsBoardActionRegistration,
  ctx: PluginAgentsBoardActionContext
): void {
  invokePluginSlotRun(slot.pluginId, slot.id, 'experimental_agentsBoardAction', () => slot.run(ctx));
}
