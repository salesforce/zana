/** @param {import('@zana-ai/zcc-plugin-sdk').ZccPluginApi} zcc */
export default function plugin(zcc) {
  zcc.settings.define({
    memoryEnabled: {
      type: 'boolean',
      label: 'Memory',
      description: 'Let Codex read and write memories between sessions.',
      default: true
    },
    subagentsDisabled: {
      type: 'boolean',
      label: 'Disable subagents',
      description: 'Prevent Codex from launching collab / sub-agent workers.',
      default: false
    }
  });
  zcc.agents.experimental_registerProvider({
    id: 'codex',
    displayName: 'Codex',
    icon: './icons/codex.svg',
    capabilities: {
      supportsServiceTier: true,
      supportsNativeUserQuestion: false,
      fork: 'checkpoint',
      supportsManualCompaction: true,
      supportsThreadArchive: true,
      supportsThreadRename: true,
      supportsWorkflows: false,
      permissionModes: ['accept-edits', 'auto', 'full'],
      reasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']
    },
    composerActions: ['plan', 'goal'],
    deriveProviderOptions(context) {
      const flag = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
      return {
        memoryEnabled: flag(context.settings.memoryEnabled, true),
        providerSubagentsEnabled: !flag(context.settings.subagentsDisabled, false)
      };
    }
  });
}
