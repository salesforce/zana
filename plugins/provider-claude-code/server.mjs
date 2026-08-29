/** @param {import('@zana-ai/zcc-plugin-sdk').ZccPluginApi} zcc */
export default function plugin(zcc) {
  zcc.agents.experimental_registerProvider({
    id: 'claude-code',
    displayName: 'Claude Code',
    icon: './icons/claude-code.svg',
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: true,
      fork: 'checkpoint',
      supportsManualCompaction: true,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsWorkflows: true,
      permissionModes: ['accept-edits', 'auto', 'full'],
      reasoningLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'ultracode', 'max']
    },
    composerActions: ['plan']
  });
}
