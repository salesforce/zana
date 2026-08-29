/** @param {import('@zana-ai/zcc-plugin-sdk').ZccPluginApi} zcc */
export default function plugin(zcc) {
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
    composerActions: ['plan', 'goal']
  });
}
