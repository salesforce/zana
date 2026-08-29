import type { HarnessRegistration } from '../registration.js';
import { CodexProvider } from './provider.js';
import { discoverCodexModels } from '../codex-model-catalog.js';
import { CodexTranscriptAdapter } from './session.js';

const implementation = new CodexProvider();

export const codexHarness: HarnessRegistration = {
  id: 'codex',
  label: 'Codex',
  profiles: [
    { id: 'codex', posture: 'default' },
    { id: 'codex-resume', posture: 'resume' },
    { id: 'codex-yolo', posture: 'unrestricted' }
  ],
  defaultProfileId: 'codex',
  implementation,
  renderRemoteCommand: (input) => implementation.buildRemoteCommand(input),
  nativeConversationResume: (nativeConversationId) =>
    nativeConversationId ? { profile: 'codex-resume', resumeSessionId: nativeConversationId } : undefined,
  nativeConversationId: (session) => session.codexSessionId,
  nativeSessionPatch: (nativeConversationId) =>
    nativeConversationId ? { kind: 'codex', codexSessionId: nativeConversationId } : undefined,
  restoreProjection: ({ session, extraArgs }) => ({
    profile: 'codex-resume',
    extraArgs: extraArgs?.length ? [...extraArgs] : undefined,
    resumeSessionId: session.codexSessionId
  }),
  createTranscriptAdapter: () => new CodexTranscriptAdapter(),
  monitorCapability: { state: 'unsupported', sources: [], reason: 'No live native monitor fact is wired' },
  supportedScopes: ['local', 'remote'],
  verification: {
    enabledConfigKey: 'harnessCodexEnabled',
    installHint: 'npm i -g @openai/codex',
    versionArgs: ['--version']
  },
  async refreshCatalog({ binary, normalizedVersion }) {
    implementation.setDiscoveredModels(await discoverCodexModels(binary, `${binary}:${normalizedVersion ?? ''}`));
  }
};
