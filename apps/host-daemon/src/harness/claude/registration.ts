import type { HarnessRegistration } from '../registration.js';
import { ClaudeCodeProvider } from './provider.js';
import { claudeTranscript } from './session.js';
import { renderClaudeLifecycle } from './hooks.js';

const implementation = new ClaudeCodeProvider();

export const claudeHarness: HarnessRegistration = {
  id: 'claude',
  label: 'Claude Code',
  profiles: [
    { id: 'claude', posture: 'default' },
    { id: 'claude-resume', posture: 'resume' },
    { id: 'claude-yolo', posture: 'unrestricted' }
  ],
  defaultProfileId: 'claude',
  implementation,
  renderRemoteCommand: (input) => implementation.buildRemoteCommand(input),
  nativeConversationResume: (nativeConversationId) =>
    nativeConversationId ? { profile: 'claude', extraArgs: ['--resume', nativeConversationId] } : undefined,
  nativeConversationId: (session) => session.claudeSessionId,
  restoreProjection: ({ session, extraArgs }) => {
    const args = (extraArgs ?? []).filter((arg, index, all) => {
      const previous = all[index - 1];
      return arg !== '--continue' && arg !== '-c' && arg !== '--resume' && previous !== '--resume';
    });
    const resume = session.claudeSessionId
      ? { profile: 'claude' as const, extraArgs: [...args, '--resume', session.claudeSessionId] }
      : { profile: session.profile, extraArgs: args.length ? args : undefined };
    return resume;
  },
  renderLifecycle: (input) => renderClaudeLifecycle(input),
  createTranscriptAdapter: () => claudeTranscript,
  supportedScopes: ['local', 'remote'],
  verification: {
    alwaysEnabled: true,
    installHint: 'https://claude.com/claude-code',
    versionArgs: ['--version']
  }
};
