/**
 * Host wiring for resume-after-API-error (issue #421). Kept out of host.ts so
 * the collaborators are injectable and unit-testable; host.ts only constructs
 * the service and forwards events.
 */
import type { ApiErrorResumeConfig } from '@zana-ai/zcc-domain/product';
import {
  ApiErrorResumeService,
  openRegexSession
} from '@zana-ai/zcc-server/services/followups/api-error-resume';

export interface ApiErrorResumeWiringDeps {
  getConfig: () => { apiErrorResume?: ApiErrorResumeConfig };
  ptys: {
    getSession: (id: string) => { projectId: string; title: string; status: string; lastInputAt?: number } | undefined | null;
    reply: (id: string, text: string) => boolean;
  };
  agentStatus: {
    get: (id: string) => string;
    markBlocked: (id: string) => void;
    turnFinished: (id: string) => void;
    clearToolsInFlight: (id: string) => void;
  };
  inboxStore: { append: (input: any) => Promise<unknown> };
  /** A headless Squad worker has no human to wait on; it keeps the engine's own fallback. */
  suppressesInteractiveBlocked: (session: any) => boolean;
  logMainError: (label: string, error: unknown) => void;
}

export function createApiErrorResume(deps: ApiErrorResumeWiringDeps): ApiErrorResumeService {
  return new ApiErrorResumeService({
    getConfig: () => deps.getConfig().apiErrorResume,
    getSession: (id) => {
      const s = deps.ptys.getSession(id);
      return s ? { projectId: s.projectId, title: s.title, status: s.status, lastInputAt: s.lastInputAt } : null;
    },
    getAgentState: (id) => deps.agentStatus.get(id),
    reply: (id, text) => deps.ptys.reply(id, text),
    markNeedsYou: (id) => {
      if (!deps.suppressesInteractiveBlocked(deps.ptys.getSession(id))) deps.agentStatus.markBlocked(id);
    },
    pushInbox: (input) => {
      void deps.inboxStore.append(input).catch((err) => deps.logMainError('api-error-resume pushInbox', err));
    },
    openRegex: () => openRegexSession(),
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle),
    log: (line) => console.log(line)
  });
}

/**
 * An API-error stop ends the turn like a Stop would (so the tab leaves
 * "working"), then lets the service decide whether a rule resumes it. It does
 * not touch the scheduler or goals: a failed turn is not a finished run.
 */
export function handleApiErrorStop(
  deps: Pick<ApiErrorResumeWiringDeps, 'agentStatus' | 'logMainError'> & { service: ApiErrorResumeService },
  sessionId: string,
  event: { error: string; text: string }
): void {
  deps.agentStatus.turnFinished(sessionId);
  deps.agentStatus.clearToolsInFlight(sessionId);
  void deps.service.onApiErrorStop(sessionId, event).catch((err) => deps.logMainError('api-error-resume', err));
}
