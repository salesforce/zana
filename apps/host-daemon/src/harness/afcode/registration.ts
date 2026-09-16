import type { HarnessRegistration } from '../registration.js';
import { stripSessionResumeFlags } from '../argv-utils.js';
import { AfcodeProvider } from './provider.js';

const implementation = new AfcodeProvider();
export const afcodeHarness: HarnessRegistration = {
  id: 'afcode', label: 'Agentforce Code',
  profiles: [
    { id: 'afcode', posture: 'default' },
    { id: 'afcode-resume', posture: 'resume' },
    { id: 'afcode-yolo', posture: 'unrestricted' }
  ],
  defaultProfileId: 'afcode', implementation,
  renderRemoteCommand: (input) => implementation.buildRemoteCommand(input),
  // Without a known native id, let the user pick. Never resume global latest.
  restoreProjection: ({ session, extraArgs }) => ({
    profile: 'afcode-resume',
    extraArgs: stripSessionResumeFlags(extraArgs),
    ...(session.nativeConversationId ? { resumeSessionId: session.nativeConversationId } : {})
  }),
  nativeConversationResume: (id) => id ? { profile: 'afcode', resumeSessionId: id } : undefined,
  nativeConversationId: (session) => session.nativeConversationId,
  supportedScopes: ['local'],
  verification: {
    enabledConfigKey: 'harnessAfcodeEnabled',
    installHint: 'https://git.soma.salesforce.com/grebmann/afcode/tree/u/grebmann/add-ACP-for-zana-ide',
    versionArgs: ['--version']
  }
};
