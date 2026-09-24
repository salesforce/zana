import { createCursorHistory } from './history.js';
import type { HarnessRegistration } from '../registration.js';
import { CursorProvider } from './provider.js';
import { discoverCursorModels } from '../cursor-model-catalog.js';
import { stripSessionResumeFlags } from '../argv-utils.js';
import { cursorChatMinter } from './create-chat.js';

const implementation = new CursorProvider();

export const cursorHarness: HarnessRegistration = {
  id: 'cursor',
  createHistoryAdapter: createCursorHistory,
  historyIconId: 'acp-cursor',
  label: 'Cursor',
  profiles: [
    { id: 'cursor', posture: 'default' },
    { id: 'cursor-resume', posture: 'resume' },
    { id: 'cursor-yolo', posture: 'unrestricted' }
  ],
  defaultProfileId: 'cursor',
  implementation,
  renderRemoteCommand: (input) => implementation.buildRemoteCommand(input),
  nativeConversationResume: (nativeConversationId) =>
    nativeConversationId ? { profile: 'cursor', resumeSessionId: nativeConversationId } : undefined,
  nativeConversationId: (session) => session.nativeConversationId,
  nativeSessionPatch: (nativeConversationId) =>
    nativeConversationId ? { kind: 'native', nativeConversationId } : undefined,
  async prepareNativeSession({ config, cwd }) {
    const binary = config.cursorBinary || 'cursor-agent';
    const id = await cursorChatMinter.mint(binary, cwd);
    return id ? { id } : undefined;
  },
  restoreProjection: ({ session, extraArgs }) => {
    const args = stripSessionResumeFlags(extraArgs);
    return session.nativeConversationId
      ? { profile: 'cursor', extraArgs: args, resumeSessionId: session.nativeConversationId }
      : { profile: 'cursor-resume', extraArgs: args };
  },
  supportedScopes: ['local', 'remote'],
  verification: {
    enabledConfigKey: 'harnessCursorEnabled',
    installHint: 'https://cursor.com/cli',
    versionArgs: ['--version']
  },
  async refreshCatalog({ binary, normalizedVersion }) {
    implementation.setDiscoveredModels(
      await discoverCursorModels(binary, `${binary}:${normalizedVersion ?? ''}`)
    );
  }
};
