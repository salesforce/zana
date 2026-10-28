/**
 * Host wiring for "Wrap up before closing" (issue #537). Kept out of host.ts so
 * the collaborators are injectable and unit-testable; host.ts only constructs
 * the service, forwards agent status and exit events, and exposes it to IPC.
 */
import { resolveCloseWrapUpInstructions, type AppConfig } from '@zana-ai/zcc-domain/product';
import { isClaudeProfile } from '@zana-ai/zcc-domain/launch-provider';
import type { CloseSummaryService } from '@zana-ai/zcc-server/services/followups/close-summary';
import { WrapUpCloseService } from '@zana-ai/zcc-server/services/followups/wrap-up-close';

type PtySession = {
  projectId: string;
  profile: string;
  status: string;
  title: string;
  lastKeyInputAt?: number;
  draftPending?: boolean;
};

export interface WrapUpCloseWiringDeps {
  store: { getConfig: () => Pick<AppConfig, 'closeWrapUpInstructions'> };
  ptys: {
    getSession: (id: string) => PtySession | undefined | null;
    reply: (id: string, text: string) => boolean;
  };
  agentStatus: { get: (id: string) => string; markBlocked: (id: string) => void };
  closeSummary: Pick<CloseSummaryService, 'summarizeForClose' | 'recordClose' | 'recordKeptOpen'>;
  providerCapabilities: (profile: any) => { hasTranscript: boolean };
  /** True for a session whose harness runs on a remote host over ssh (it has no Stop hook). */
  isRemoteSession: (session: any) => boolean;
  /** A headless Squad worker has no human to wait on; it is never marked "needs you". */
  suppressesInteractiveBlocked: (session: any) => boolean;
}

export function createWrapUpClose(deps: WrapUpCloseWiringDeps): WrapUpCloseService {
  return new WrapUpCloseService({
    getInstructions: () => resolveCloseWrapUpInstructions(deps.store.getConfig()),
    getSession: (id) => {
      const s = deps.ptys.getSession(id);
      return s
        ? {
            projectId: s.projectId,
            profile: s.profile,
            status: s.status,
            title: s.title,
            lastKeyInputAt: s.lastKeyInputAt,
            draftPending: s.draftPending,
            remote: deps.isRemoteSession(s)
          }
        : null;
    },
    hasTranscript: (profile) => deps.providerCapabilities(profile).hasTranscript,
    isTypeable: (profile) => isClaudeProfile(profile as never),
    getAgentState: (id) => deps.agentStatus.get(id),
    reply: (id, text) => deps.ptys.reply(id, text),
    markNeedsYou: (id) => {
      // A session that is gone has nobody to wait on; a headless worker is never marked either.
      const session = deps.ptys.getSession(id);
      if (session && !deps.suppressesInteractiveBlocked(session)) deps.agentStatus.markBlocked(id);
    },
    summarizeForClose: (projectId, sessionId) => deps.closeSummary.summarizeForClose(projectId, sessionId),
    recordClose: (...args) => deps.closeSummary.recordClose(...args),
    recordKeptOpen: (...args) => deps.closeSummary.recordKeptOpen(...args),
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle),
    log: (line) => console.log(line)
  });
}
