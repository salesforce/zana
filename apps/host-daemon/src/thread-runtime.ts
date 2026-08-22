import type { HostEventEnvelope } from '@zana-ai/zcc-contracts/host-rpc';
import { parseProfile, seedPromptArgs } from '@zana-ai/zcc-domain/launch-provider';
import type { AppConfig, LaunchProfileId } from '@zana-ai/zcc-domain/product';
import { HostCommandError } from './host-command-error.js';
import { HARNESS_REGISTRATIONS, registrationFor } from './harness/registry.js';
import { PtyManager } from './pty.js';
import type { ThreadWorkInput } from './command-dispatch.js';

export interface ThreadRuntimeAdapter {
  startWork(input: ThreadWorkInput): Promise<void>;
  submitTurn(input: { threadId: string; input: string[] }): Promise<void>;
  resizeWork(input: { threadId: string; cols: number; rows: number }): Promise<void>;
  dispose(): void;
}

function resolveProfile(providerId: string): LaunchProfileId {
  const asProfile = parseProfile(providerId);
  if (asProfile) return asProfile;
  const registration = HARNESS_REGISTRATIONS.find((entry) => entry.id === providerId);
  const profile = registration?.defaultProfileId ?? registration?.profiles[0]?.id;
  if (!profile || !registrationFor(profile)) {
    throw new HostCommandError('provider_unavailable', `unknown provider: ${providerId}`);
  }
  return profile;
}

/**
 * Thin adapter over the existing ZCC PTY launcher. Not a port of BB
 * `@bb/agent-runtime` — spawn identity still comes from `registrationFor` +
 * `PtyManager.create`.
 */
export function createPtyThreadAdapter(options: {
  loadConfig: () => AppConfig;
  emit: (event: HostEventEnvelope) => void;
  pty?: PtyManager;
}): ThreadRuntimeAdapter {
  const pty = options.pty ?? new PtyManager();
  const roots = new Set<string>();
  const threadToSession = new Map<string, string>();
  const sessionToThread = new Map<string, string>();

  pty.setProjectRoots(() => [...roots]);
  pty.on('data', (sessionId: string, data: string) => {
    const threadId = sessionToThread.get(sessionId);
    if (!threadId) return;
    options.emit({ threadId, kind: 'terminal.output', payload: { data } });
  });
  pty.on('exit', (sessionId: string, exitCode: number) => {
    const threadId = sessionToThread.get(sessionId);
    if (!threadId) return;
    threadToSession.delete(threadId);
    sessionToThread.delete(sessionId);
    options.emit({
      threadId,
      kind: exitCode === 0 ? 'turn.completed' : 'turn.failed',
      payload: { exitCode }
    });
  });

  return {
    async startWork(input) {
      const profile = resolveProfile(input.providerId);
      roots.add(input.cwd);
      const prompt = input.input.join('\n');
      try {
        const session = pty.create({
          preallocatedSessionId: input.threadId,
          projectId: input.projectId,
          profile,
          cwd: input.cwd,
          cols: 80,
          rows: 24,
          config: options.loadConfig(),
          extraArgs: seedPromptArgs(profile, prompt),
          title: prompt.slice(0, 80)
        });
        threadToSession.set(input.threadId, session.id);
        sessionToThread.set(session.id, input.threadId);
      } catch (error) {
        throw new HostCommandError(
          'provider_unavailable',
          error instanceof Error ? error.message : String(error)
        );
      }
    },
    async submitTurn(input) {
      const sessionId = threadToSession.get(input.threadId);
      if (!sessionId || !pty.reply(sessionId, input.input.join('\n'))) {
        throw new HostCommandError('unknown_thread', 'thread is not running on this host');
      }
    },
    async resizeWork(input) {
      const sessionId = threadToSession.get(input.threadId);
      if (!sessionId) {
        throw new HostCommandError('unknown_thread', 'thread is not running on this host');
      }
      pty.resize(sessionId, input.cols, input.rows);
    },
    dispose() {
      pty.killAll();
      pty.removeAllListeners();
    }
  };
}
