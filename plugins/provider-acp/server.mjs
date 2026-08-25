/** @param {import('@zana-ai/zcc-plugin-sdk').ZccPluginApi} zcc */
export default function plugin(zcc) {
  zcc.agents.experimental_registerProvider({
    id: 'acp-cursor',
    displayName: 'Cursor',
    icon: './icons/cursor.svg',
    capabilities: {
      supportsServiceTier: true,
      supportsNativeUserQuestion: false,
      fork: 'tip',
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsWorkflows: false,
      permissionModes: ['accept-edits', 'full'],
      reasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max']
    },
    composerActions: []
  });
  zcc.agents.experimental_registerProvider({
    id: 'acp-opencode',
    displayName: 'OpenCode',
    icon: './icons/opencode.svg',
    capabilities: {
      supportsServiceTier: true,
      supportsNativeUserQuestion: false,
      fork: 'tip',
      supportsManualCompaction: true,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsWorkflows: false,
      permissionModes: ['accept-edits', 'full'],
      reasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max']
    },
    composerActions: []
  });
}
