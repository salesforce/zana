/** @param {import('@zana-ai/zcc-plugin-sdk').ZccPluginApi} zcc */
export default function plugin(zcc) {
  zcc.agents.experimental_registerProvider({
    id: 'pi',
    displayName: 'Pi',
    icon: './icons/pi.svg',
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      fork: 'checkpoint',
      supportsManualCompaction: true,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsWorkflows: false,
      permissionModes: ['full'],
      reasoningLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max']
    },
    composerActions: []
  });
}
