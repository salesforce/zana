import type { HostEventEnvelope } from '@zana-ai/zcc-contracts/host-rpc';
import { parseProfile, seedPromptArgs } from '@zana-ai/zcc-domain/launch-provider';
import { sanitizeExtraArgs } from '@zana-ai/zcc-domain/launch-sanitize';
import type {
  AppConfig,
  HarnessModelRoutingV1,
  LaunchProfileId,
  Persona,
  ProjectRemote,
  SessionCohort
} from '@zana-ai/zcc-domain/product';
import { HostCommandError } from './host-command-error.js';
import { HARNESS_REGISTRATIONS, registrationFor } from './harness/registry.js';
import { PtyManager } from './pty.js';
import type { ThreadWorkInput } from './command-dispatch.js';

export interface ThreadRuntimeAdapter {
  startWork(input: ThreadWorkInput): Promise<void>;
  submitTurn(input: { threadId: string; input: string[] }): Promise<void>;
  resizeWork(input: { threadId: string; cols: number; rows: number }): Promise<void>;
  writeWork(input: { threadId: string; data: string }): Promise<void>;
  stopWork(input: { threadId: string }): Promise<void>;
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

  function sessionIdFor(threadId: string): string {
    const sessionId = threadToSession.get(threadId);
    if (!sessionId) {
      throw new HostCommandError('unknown_thread', 'thread is not running on this host');
    }
    return sessionId;
  }

  return {
    async startWork(input) {
      const profile = resolveProfile(input.providerId);
      roots.add(input.cwd);
      const prompt = input.input.join('\n').trim();
      const { args: safeExtraArgs } = sanitizeExtraArgs(input.extraArgs);
      const extraArgs = [
        ...safeExtraArgs,
        ...(prompt ? seedPromptArgs(profile, prompt) : [])
      ];
      try {
        const session = pty.create({
          preallocatedSessionId: input.threadId,
          projectId: input.projectId,
          profile,
          cwd: input.cwd,
          cols: 80,
          rows: 24,
          config: options.loadConfig(),
          extraArgs,
          harnessRouting: input.harnessRouting as HarnessModelRoutingV1 | undefined,
          title: input.title ?? (prompt ? prompt.slice(0, 80) : profile === 'shell' ? 'Shell' : 'Agent'),
          persona: input.persona as Persona | undefined,
          headless: input.headless,
          scheduled: input.scheduled,
          autoCloseOnFinish: input.autoCloseOnFinish,
          inboxLevel: input.inboxLevel,
          autonomous: input.autonomous,
          resumeSessionId: input.resumeSessionId,
          environment: input.environment,
          sandboxDenyNetwork: input.sandboxDenyNetwork,
          microVmImage: input.microVmImage,
          microVmCpus: input.microVmCpus,
          microVmMemoryMib: input.microVmMemoryMib,
          remote: input.remote as ProjectRemote | undefined,
          reconnectTmuxId: input.reconnectTmuxId,
          resume: input.resume,
          cohort: input.cohort as SessionCohort | undefined
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
      const sessionId = sessionIdFor(input.threadId);
      if (!pty.reply(sessionId, input.input.join('\n'))) {
        throw new HostCommandError('unknown_thread', 'thread is not running on this host');
      }
    },
    async resizeWork(input) {
      pty.resize(sessionIdFor(input.threadId), input.cols, input.rows);
    },
    async writeWork(input) {
      pty.write(sessionIdFor(input.threadId), input.data);
    },
    async stopWork(input) {
      const sessionId = threadToSession.get(input.threadId);
      if (!sessionId) return;
      pty.close(sessionId);
      threadToSession.delete(input.threadId);
      sessionToThread.delete(sessionId);
    },
    dispose() {
      pty.killAll();
      pty.removeAllListeners();
    }
  };
}
