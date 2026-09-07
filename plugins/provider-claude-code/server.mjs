/** @param {import('@zana-ai/zcc-plugin-sdk').ZccPluginApi} zcc */
export default function plugin(zcc) {
  zcc.settings.define({
    memoryEnabled: {
      type: 'boolean',
      label: 'Memory',
      description: 'Let Claude Code read and write auto-memory between sessions.',
      default: true
    },
    subagentsDisabled: {
      type: 'boolean',
      label: 'Disable subagents',
      description: 'Prevent Claude Code from launching Task subagents.',
      default: false
    },
    workflowsDisabled: {
      type: 'boolean',
      label: 'Disable workflows',
      description: 'Hide Claude Code workflow tools.',
      default: false
    },
    idleQueryReleaseEnabled: {
      type: 'boolean',
      label: 'Release idle Claude processes',
      description:
        'Close a quiescent Claude Code process after 30 seconds and resume it on the next turn.',
      default: false
    },
    chromeEnabled: {
      type: 'boolean',
      label: 'Claude in Chrome',
      description: 'Allow Claude Code to drive a Chrome browser.',
      default: false
    }
  });
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
      reasoningLevels: ['low', 'medium', 'high', 'xhigh', 'ultracode', 'max']
    },
    composerActions: ['plan'],
    deriveProviderOptions(context) {
      const flag = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
      return {
        memoryEnabled: flag(context.settings.memoryEnabled, true),
        providerSubagentsEnabled: !flag(context.settings.subagentsDisabled, false),
        workflowsEnabled: !flag(context.settings.workflowsDisabled, false),
        idleQueryReleaseEnabled: flag(context.settings.idleQueryReleaseEnabled, false),
        chromeEnabled: flag(context.settings.chromeEnabled, false),
        ...(context.promptMode === 'plan' ? { claudeCodePermissionMode: 'plan' } : {})
      };
    }
  });
}
