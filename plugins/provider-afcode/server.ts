import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk';

/** The host owns launch authorization; this plugin supplies the ACP dialect. */
export default function plugin(zcc: ZccPluginApi) {
  zcc.settings.define({
    executable: {
      type: 'string', label: 'afcode executable', default: 'afcode',
      description: 'Command or absolute path to an ACP-enabled afcode binary. CLI Agents use the binary setting in Agents settings.'
    }
  });
  zcc.agents.experimental_registerProvider({
    id: 'acp-afcode', displayName: 'afcode', icon: 'Terminal',
    visibility: 'always',
    capabilities: {
      supportsServiceTier: false, supportsNativeUserQuestion: false,
      fork: 'none', supportsManualCompaction: false,
      supportsThreadArchive: false, supportsThreadRename: false,
      supportsWorkflows: false, permissionModes: ['accept-edits', 'full']
    },
    composerActions: [],
    env: { passthrough: ['LLM_GATEWAY_EXPRESS_API_KEY', 'LLM_GATEWAY_EXPRESS_URL', 'AFCODE_MODEL'] },
    deriveProviderOptions({ settings }) {
      const value = settings.executable;
      const command = typeof value === 'string' && value.trim() ? value.trim() : 'afcode';
      return {
        acpLaunchSpec: { displayName: 'afcode', command, args: ['acp'], env: {} },
        acpDialect: 'generic'
      };
    }
  });
  zcc.agents.experimental_registerPtyHarness({
    id: 'afcode', displayName: 'afcode', icon: 'Terminal',
    profiles: [
      { id: 'afcode', label: 'afcode' },
      { id: 'afcode-resume', label: 'afcode (resume picker)' },
      { id: 'afcode-yolo', label: 'afcode (unrestricted)' }
    ],
    enableConfigKey: 'harnessAfcodeEnabled'
  });
}
