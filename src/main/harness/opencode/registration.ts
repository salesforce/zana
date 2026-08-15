import type { HarnessRegistration } from '../registration.js';
import { OpenCodeProvider } from './provider.js';
import { OpenCodeTranscriptAdapter } from './session.js';

const implementation = new OpenCodeProvider();

export const openCodeHarness: HarnessRegistration = {
  id: 'opencode',
  label: 'OpenCode',
  profiles: [
    { id: 'opencode', posture: 'default' },
    { id: 'opencode-resume', posture: 'resume' }
  ],
  defaultProfileId: 'opencode',
  implementation,
  renderRemoteCommand: (input) => implementation.buildRemoteCommand(input),
  discoverAgentDescriptors: ({ cwd, config, refresh }) =>
    implementation.discoverAgentDescriptors({ cwd, config }, { bypassCache: refresh }),
  nativeConversationResume: (nativeConversationId) =>
    nativeConversationId ? { profile: 'opencode-resume', resumeSessionId: nativeConversationId } : undefined,
  nativeConversationId: (session) => session.openCodeSessionId,
  nativeSessionPatch: (nativeConversationId) =>
    nativeConversationId ? { kind: 'opencode', openCodeSessionId: nativeConversationId } : undefined,
  restoreProjection: ({ session, extraArgs }) => {
    const args: string[] = [];
    for (let index = 0; index < (extraArgs?.length ?? 0); index += 1) {
      const arg = extraArgs![index];
      if (arg === '--prompt') {
        index += 1;
        continue;
      }
      if (!arg.startsWith('--prompt=')) args.push(arg);
    }
    return {
      profile: 'opencode-resume',
      extraArgs: args.length ? args : undefined,
      resumeSessionId: session.openCodeSessionId
    };
  },
  createTranscriptAdapter: ({ openCodeBinary }) => new OpenCodeTranscriptAdapter(openCodeBinary),
  supportedScopes: ['local', 'remote'],
  verification: {
    enabledConfigKey: 'harnessOpenCodeEnabled',
    installHint: 'https://opencode.ai — npm i -g opencode-ai',
    versionArgs: ['--version']
  }
};
