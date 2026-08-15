import type { HarnessLegacyRoutingAdapter } from '../legacy-routing-adapter.js';

export const claudeLegacyRouting: HarnessLegacyRoutingAdapter = {
  resolveModel(context, source) {
    if (source === 'persona') {
      const routing = context.persona?.harnessRouting?.byAdapter?.claude;
      const targetId = routing?.compatibility?.model as string | undefined ?? context.persona?.model;
      return targetId ? { targetId } : undefined;
    }
    if (source === 'project') {
      const routing = context.projectSettings?.harnessRouting?.byAdapter?.claude;
      const targetId = routing?.compatibility?.model as string | undefined ?? context.projectSettings?.model;
      return targetId ? { targetId } : undefined;
    }
    const targetId = context.config.defaultModel;
    return targetId && targetId !== 'default' ? { targetId } : undefined;
  }
};
