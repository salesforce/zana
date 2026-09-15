import type { HarnessRegistration } from '../registration.js';
import { GrokProvider } from './provider.js';
import { stripSessionResumeFlags } from '../argv-utils.js';

const implementation = new GrokProvider();

export const grokHarness: HarnessRegistration = {
  id: 'grok',
  label: 'Grok Build',
  profiles: [
    { id: 'grok', posture: 'default' },
    { id: 'grok-resume', posture: 'resume' },
    { id: 'grok-yolo', posture: 'unrestricted' }
  ],
  defaultProfileId: 'grok',
  implementation,
  renderRemoteCommand: (input) => implementation.buildRemoteCommand(input),
  nativeConversationResume: (nativeConversationId) =>
    nativeConversationId ? { profile: 'grok', resumeSessionId: nativeConversationId } : undefined,
  nativeConversationId: (session) => session.nativeConversationId,
  nativeSessionPatch: (nativeConversationId) =>
    nativeConversationId ? { kind: 'native', nativeConversationId } : undefined,
  nativeSessionMint: {
    spawnArgs: (id) => ['--session-id', id]
  },
  restoreProjection: ({ session, extraArgs }) => {
    const args = stripSessionResumeFlags(extraArgs);
    return session.nativeConversationId
      ? { profile: 'grok', extraArgs: args, resumeSessionId: session.nativeConversationId }
      : { profile: 'grok-resume', extraArgs: args };
  },
  supportedScopes: ['local', 'remote'],
  verification: {
    enabledConfigKey: 'harnessGrokEnabled',
    installHint: 'https://docs.x.ai/docs/grok-build',
    versionArgs: ['--version']
  }
};
