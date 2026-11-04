/**
 * Resume after API errors (issue #421) — when an agent stops on an API error
 * whose text matches a user-configured rule, type the rule's message
 * (default "continue") into it after a delay.
 *
 * Same shape as {@link HeartbeatService}: every collaborator is injected (no
 * Electron, timers via deps) and every eligibility gate is re-checked when the
 * timer fires, because the agent may have moved on during the delay.
 *
 * Safety:
 *  - Sends only while the agent rests (`idle`/`done`/`waiting`), never into a
 *    permission prompt (`blocked`) or while it works.
 *  - Yields to the human: if `lastInputAt` changed since arming, the person
 *    typed, so we stay out of the way. `reply()` never stamps `lastInputAt`.
 *  - Regex rules run in the bounded regex worker (time limit, no main-loop
 *    ReDoS); a slow or invalid rule is skipped, never fatal.
 *  - A per-session cap (`maxPerWindow` in `windowMinutes`) marks the tab
 *    "needs you" and stops resuming.
 */

import {
  API_ERROR_RESUME_DEFAULTS,
  buildApiErrorMatchText,
  type ApiErrorResumeConfig,
  type ApiErrorResumeRule
} from '@zana-ai/zcc-domain/product';
import { createRegexScanner } from '../projects/regex-worker.js';

export type RegexMatchResult = 'match' | 'no-match' | 'timeout' | 'unavailable' | 'invalid';
export type RegexMatcher = (text: string, pattern: string, flags: string) => Promise<RegexMatchResult>;
export interface RegexSession { match: RegexMatcher; dispose: () => void }

/**
 * One regex worker for a whole rule check: it starts on the first regex rule and
 * is reused for the rest and for retries. A timeout or crash stops the worker,
 * so the next rule starts a fresh one.
 */
export function openRegexSession(createScanner: typeof createRegexScanner = createRegexScanner): RegexSession {
  let scanner: ReturnType<typeof createRegexScanner> = null;
  const dispose = () => {
    scanner?.dispose();
    scanner = null;
  };
  const match: RegexMatcher = async (text, pattern, flags) => {
    scanner ??= createScanner();
    if (!scanner) return 'unavailable';
    try {
      const hits = await scanner.scan(text, pattern, flags);
      return hits.length > 0 ? 'match' : 'no-match';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Invalid search expression')) return 'invalid'; // the worker is still usable
      dispose();
      return message.includes('time limit') ? 'timeout' : 'unavailable';
    }
  };
  return { match, dispose };
}

export type SkippedReason = 'timeout' | 'unavailable' | 'invalid';
export interface SkippedRule { ruleId: string; reason: SkippedReason }

export interface ApiErrorResumeSession {
  projectId: string;
  title: string;
  status: string;
  lastInputAt?: number;
}

export interface ApiErrorResumeDeps {
  getConfig: () => ApiErrorResumeConfig | undefined;
  getSession: (sessionId: string) => ApiErrorResumeSession | null;
  getAgentState: (sessionId: string) => string;
  /** Type a line into the session (body + deferred CR). Returns false if gone. */
  reply: (sessionId: string, text: string) => boolean;
  markNeedsYou: (sessionId: string) => void;
  pushInbox: (input: { projectId: string; subject?: string; comments: string; dedupeKey?: string }) => void;
  /** A regex worker session for one rule check; disposed when the check ends. */
  openRegex: () => RegexSession;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearTimer: (handle: NodeJS.Timeout) => void;
  log: (line: string) => void;
}

interface Pending {
  timer: NodeJS.Timeout;
  ruleId: string;
  /** The rule as armed; an edit during the wait must not send for the old match. */
  match: string;
  matchMode: ApiErrorResumeRule['matchMode'];
  caseSensitive: boolean;
  lastInputAt: number | undefined;
}

const RESTING = new Set(['idle', 'done', 'waiting']);
const UNAVAILABLE_RETRIES = 3;
const UNAVAILABLE_RETRY_MS = 1000;
const MAX_WINDOW_MS = API_ERROR_RESUME_DEFAULTS.maxWindowMinutes * 60000;

export class ApiErrorResumeService {
  private pending = new Map<string, Pending>();
  private sends = new Map<string, number[]>();
  /** Bumped by every new stop, cancel and forget, so a stale async match can't arm. */
  private epochs = new Map<string, number>();
  /** Sessions whose turn ended on an API error and haven't started a new one. */
  private rested = new Set<string>();

  constructor(private readonly deps: ApiErrorResumeDeps) {}

  async findRule(
    matchText: string,
    rules: ApiErrorResumeRule[],
    { retry }: { retry: boolean }
  ): Promise<{ rule?: ApiErrorResumeRule; skipped: SkippedRule[] }> {
    const skipped: SkippedRule[] = [];
    const lowered = matchText.toLowerCase();
    const regex = this.deps.openRegex();
    try {
      for (const rule of rules) {
        if (!rule.enabled) continue;
        if (rule.matchMode === 'contains') {
          if (lowered.includes(rule.match.toLowerCase())) return { rule, skipped };
          continue;
        }
        const flags = rule.caseSensitive ? '' : 'i';
        let result = await regex.match(matchText, rule.match, flags);
        for (let attempt = 0; retry && result === 'unavailable' && attempt < UNAVAILABLE_RETRIES; attempt++) {
          await new Promise<void>(resolve => this.deps.setTimer(resolve, UNAVAILABLE_RETRY_MS));
          result = await regex.match(matchText, rule.match, flags);
        }
        if (result === 'match') return { rule, skipped };
        if (result !== 'no-match') skipped.push({ ruleId: rule.id, reason: result });
      }
      return { skipped };
    } finally {
      regex.dispose();
    }
  }

  async onApiErrorStop(sessionId: string, event: { error: string; text: string }): Promise<void> {
    const { deps } = this;
    const epoch = this.bump(sessionId);
    this.clearPending(sessionId); // a newer stop supersedes an earlier resume, whatever it matches
    this.rested.add(sessionId);
    const config = deps.getConfig();
    if (!config?.enabled) return deps.log(`[api-error-resume] session=${sessionId.slice(0, 8)} skip: feature off`);
    const session = deps.getSession(sessionId);
    if (!session || session.status === 'exited') {
      return deps.log(`[api-error-resume] session=${sessionId.slice(0, 8)} skip: session gone`);
    }
    const matchText = buildApiErrorMatchText(event.error, event.text);
    const { rule, skipped } = await this.findRule(matchText, config.rules, { retry: true });
    this.notifySlow(session, config.rules, skipped);
    if (this.epochs.get(sessionId) !== epoch) {
      return deps.log(`[api-error-resume] session=${sessionId.slice(0, 8)} skip: a new turn started`);
    }
    if (!rule) return deps.log(`[api-error-resume] session=${sessionId.slice(0, 8)} skip: no rule matched`);

    if (this.capReached(sessionId, session, config)) return;

    this.clearPending(sessionId);
    const timer = deps.setTimer(() => this.fire(sessionId), rule.delaySeconds * 1000);
    this.pending.set(sessionId, {
      timer,
      ruleId: rule.id,
      match: rule.match,
      matchMode: rule.matchMode,
      caseSensitive: rule.caseSensitive === true,
      lastInputAt: session.lastInputAt
    });
  }

  /**
   * Sends to this session inside the current window. History is kept for the
   * longest window Settings allows, so widening the window still counts them.
   */
  private recentSends(sessionId: string, config: ApiErrorResumeConfig, now: number): number[] {
    const kept = (this.sends.get(sessionId) ?? []).filter(t => now - t < MAX_WINDOW_MS);
    if (kept.length > 0) this.sends.set(sessionId, kept); else this.sends.delete(sessionId);
    return kept.filter(t => now - t < config.windowMinutes * 60000);
  }

  /**
   * Checked when a resume is armed and again just before it sends, so lowering
   * the cap or the window during the wait applies to the pending resume too.
   */
  private capReached(sessionId: string, session: ApiErrorResumeSession, config: ApiErrorResumeConfig): boolean {
    const { deps } = this;
    const now = deps.now();
    const sent = this.recentSends(sessionId, config, now).length;
    if (sent < config.maxPerWindow) return false;
    deps.markNeedsYou(sessionId);
    this.safely('pushInbox', () => deps.pushInbox({
      projectId: session.projectId,
      subject: `Resume stopped — ${session.title}`,
      comments:
        `Stopped resuming “${session.title}”: Zana already resumed it ${sent} ${sent === 1 ? 'time' : 'times'} ` +
        `in the last ${config.windowMinutes} minutes. Type in the agent to carry on.`,
      dedupeKey: `api-error-resume:cap:${sessionId}:${Math.floor(now / (config.windowMinutes * 60000))}`
    }));
    deps.log(`[api-error-resume] session=${sessionId.slice(0, 8)} skip: cap reached`);
    return true;
  }

  private notifySlow(session: ApiErrorResumeSession, rules: ApiErrorResumeRule[], skipped: SkippedRule[]): void {
    const day = new Date(this.deps.now()).toISOString().slice(0, 10);
    for (const s of skipped) {
      if (s.reason !== 'timeout') continue;
      const rule = rules.find(r => r.id === s.ruleId);
      if (!rule) continue;
      this.safely('pushInbox', () => this.deps.pushInbox({
        projectId: session.projectId,
        subject: 'Resume rule skipped',
        comments:
          `Rule “${rule.match}” took too long to check, so Zana skipped it. ` +
          `Simplify the pattern in Settings → Agents → Resume after API errors.`,
        dedupeKey: `api-error-resume:slow:${rule.id}:${day}`
      }));
    }
  }

  private fire(sessionId: string): void {
    const { deps } = this;
    const entry = this.pending.get(sessionId);
    this.pending.delete(sessionId);
    const tag = `[api-error-resume] session=${sessionId.slice(0, 8)}`;
    if (!entry) return;
    const config = deps.getConfig();
    if (!config?.enabled) return deps.log(`${tag} skip: feature turned off`);
    const rule = config.rules.find(r => r.id === entry.ruleId);
    if (!rule || !rule.enabled) return deps.log(`${tag} skip: rule removed or disabled`);
    if (
      rule.match !== entry.match ||
      rule.matchMode !== entry.matchMode ||
      (rule.caseSensitive === true) !== entry.caseSensitive
    ) return deps.log(`${tag} skip: rule edited`);
    const session = deps.getSession(sessionId);
    if (!session || session.status === 'exited') return deps.log(`${tag} skip: session gone`);
    const state = deps.getAgentState(sessionId);
    if (!RESTING.has(state)) return deps.log(`${tag} skip: agent is ${state}`);
    if (session.lastInputAt !== entry.lastInputAt) return deps.log(`${tag} skip: user typed`);
    if (this.capReached(sessionId, session, config)) return;
    if (!deps.reply(sessionId, rule.message)) return deps.log(`${tag} skip: reply failed`);
    const now = deps.now();
    const attempt = this.recentSends(sessionId, config, now).length + 1;
    this.sends.set(sessionId, [...(this.sends.get(sessionId) ?? []), now]);
    deps.log(`${tag} rule=${rule.id} attempt ${attempt}/${config.maxPerWindow}`);
  }

  /** Notifying is best-effort: a failure is logged and never breaks the timer path. */
  private safely(what: string, fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.deps.log(`[api-error-resume] ${what} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private bump(sessionId: string): number {
    const next = (this.epochs.get(sessionId) ?? 0) + 1;
    this.epochs.set(sessionId, next);
    return next;
  }

  private clearPending(sessionId: string): void {
    const entry = this.pending.get(sessionId);
    if (!entry) return;
    this.deps.clearTimer(entry.timer);
    this.pending.delete(sessionId);
  }

  /** A new turn, a Stop or an exit: drop the pending resume and any match still running. */
  cancel(sessionId: string): void {
    this.bump(sessionId);
    this.rested.delete(sessionId);
    this.clearPending(sessionId);
  }

  forget(sessionId: string): void {
    this.cancel(sessionId);
    this.sends.delete(sessionId);
    this.epochs.delete(sessionId);
  }

  /** True while the agent rests after an API error and no new turn has begun. */
  restedOnApiError(sessionId: string): boolean {
    return this.rested.has(sessionId);
  }

  /** Settings "Check an error": which rule would fire, without sending anything. */
  async check(text: string, rules: ApiErrorResumeRule[]): Promise<{
    ruleId: string | null;
    message?: string;
    delaySeconds?: number;
    skipped: SkippedRule[];
  }> {
    const { rule, skipped } = await this.findRule(buildApiErrorMatchText('', text), rules, { retry: false });
    return rule
      ? { ruleId: rule.id, message: rule.message, delaySeconds: rule.delaySeconds, skipped }
      : { ruleId: null, skipped };
  }
}

