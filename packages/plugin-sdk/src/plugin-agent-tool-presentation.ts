export const PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS = 80;

export interface PluginAgentToolPresentation {
  label?: { pending: string; completed: string };
  icon?: { glyph: string };
  suppress?: boolean;
  tint?: { light: string; dark: string };
}

export function parsePluginAgentToolPresentation(
  toolName: string,
  value: unknown
): PluginAgentToolPresentation | null {
  if (value === undefined) return null;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`tool "${toolName}" presentation must be an object`);
  }
  const declared = value as Record<string, unknown>;
  const presentation: PluginAgentToolPresentation = {};
  if (declared.label !== undefined) {
    const label = declared.label;
    if (
      typeof label !== 'object'
      || label === null
      || typeof (label as { pending?: unknown }).pending !== 'string'
      || typeof (label as { completed?: unknown }).completed !== 'string'
    ) {
      throw new Error(`tool "${toolName}" presentation.label must provide pending and completed strings`);
    }
    const { pending, completed } = label as { pending: string; completed: string };
    if (
      pending.trim().length === 0
      || completed.trim().length === 0
      || pending.length > PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS
      || completed.length > PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS
    ) {
      throw new Error(
        `tool "${toolName}" presentation.label strings must be non-empty and at most ${PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS} characters`
      );
    }
    presentation.label = { pending, completed };
  }
  if (declared.icon !== undefined) {
    const icon = declared.icon;
    if (
      typeof icon !== 'object'
      || icon === null
      || typeof (icon as { glyph?: unknown }).glyph !== 'string'
      || (icon as { glyph: string }).glyph.trim().length === 0
    ) {
      throw new Error(`tool "${toolName}" presentation.icon must be { glyph: string }`);
    }
    presentation.icon = { glyph: (icon as { glyph: string }).glyph };
  }
  if (declared.suppress !== undefined) {
    if (typeof declared.suppress !== 'boolean') {
      throw new Error(`tool "${toolName}" presentation.suppress must be a boolean`);
    }
    presentation.suppress = declared.suppress;
  }
  if (declared.tint !== undefined) {
    const tint = declared.tint;
    if (
      typeof tint !== 'object'
      || tint === null
      || typeof (tint as { light?: unknown }).light !== 'string'
      || typeof (tint as { dark?: unknown }).dark !== 'string'
    ) {
      throw new Error(`tool "${toolName}" presentation.tint must provide light and dark strings`);
    }
    presentation.tint = {
      light: (tint as { light: string }).light,
      dark: (tint as { dark: string }).dark
    };
  }
  return presentation;
}
