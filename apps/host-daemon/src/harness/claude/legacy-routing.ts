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
  },
  threadUnmappedFields(context, { unrestricted }) {
    // A launch appends the project's native `--permission-mode` (skipped under
    // claude-yolo); a thread only has the portable execution states.
    const mode = context.projectSettings?.permissionMode;
    return mode && !unrestricted ? [`the project Claude Code permission mode (${mode})`] : [];
  }
};
