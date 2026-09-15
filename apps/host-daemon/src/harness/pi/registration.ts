import type { HarnessRegistration } from '../registration.js';
import { PiProvider } from './provider.js';
import { stripSessionResumeFlags } from '../argv-utils.js';

const implementation = new PiProvider();

export const piHarness: HarnessRegistration = {
  id: 'pi',
  label: 'PI',
  profiles: [
    { id: 'pi', posture: 'default' },
    { id: 'pi-resume', posture: 'resume' }
  ],
  defaultProfileId: 'pi',
  implementation,
  renderRemoteCommand: (input) => implementation.buildRemoteCommand(input),
  nativeConversationResume: (nativeConversationId) =>
    nativeConversationId ? { profile: 'pi', resumeSessionId: nativeConversationId } : undefined,
  nativeConversationId: (session) => session.nativeConversationId,
  nativeSessionPatch: (nativeConversationId) =>
    nativeConversationId ? { kind: 'native', nativeConversationId } : undefined,
  nativeSessionMint: {
    spawnArgs: (id) => ['--session-id', id]
  },
  restoreProjection: ({ session, extraArgs }) => {
    const args = stripSessionResumeFlags(extraArgs);
    return session.nativeConversationId
      ? { profile: 'pi', extraArgs: args, resumeSessionId: session.nativeConversationId }
      : { profile: 'pi-resume', extraArgs: args };
  },
  supportedScopes: ['local', 'remote'],
  verification: {
    enabledConfigKey: 'harnessPiEnabled',
    installHint: 'npm i -g @earendil-works/pi-coding-agent',
    versionArgs: ['--version']
  }
};
