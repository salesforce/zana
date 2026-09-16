import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk';

const ICON = './icons/afcode.svg';

/** The host owns launch authorization; this plugin supplies the ACP dialect. */
export default function plugin(zcc: ZccPluginApi) {
  zcc.settings.define({
    executable: {
      type: 'string', label: 'Agentforce Code executable', default: 'afcode',
      description: 'Command or absolute path to an ACP-enabled afcode binary. CLI Agents use the binary setting in Agents settings.'
    }
  });
  zcc.agents.experimental_registerProvider({
    id: 'acp-afcode', displayName: 'Agentforce Code', icon: ICON,
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
        acpLaunchSpec: { displayName: 'Agentforce Code', command, args: ['acp'], env: {} },
        acpDialect: 'generic'
      };
    }
  });
  zcc.agents.experimental_registerPtyHarness({
    id: 'afcode', displayName: 'Agentforce Code', icon: ICON,
    profiles: [
      { id: 'afcode', label: 'Agentforce Code' },
      { id: 'afcode-resume', label: 'Agentforce Code (resume picker)' },
      { id: 'afcode-yolo', label: 'Agentforce Code (unrestricted)' }
    ],
    enableConfigKey: 'harnessAfcodeEnabled'
  });
}
