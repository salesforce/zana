// @ts-nocheck
import { ipcMain } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { store } from '@zana-ai/zcc-server/services/projects/store';
import { listLocalTmuxSessionIds, verifyTmux } from '@zana-ai/zcc-host-daemon/tmux';
import { isRepliable } from '../menu.js';
import { app } from 'electron';
import type { SessionStats } from '@zana-ai/zcc-host-daemon/harness/claude/transcript-reader';
import type { CatchUpSummaryResult, CreateTerminalRequest, LaunchProfileId, MenubarReplyResult, Result, TerminalSession } from '@zana-ai/zcc-domain/product';

export function registerTerminalsIpc(): void {
  
  ctx.safeHandle(IPC.terminals.list, (projectId: string) => ctx.ptys.list(projectId), () => []);
  ctx.safeHandle(
    IPC.terminals.verifyTmux,
    () => verifyTmux(),
    () => ({ installed: false, installHint: 'brew install tmux' })
  );
  ctx.safeHandle(
    IPC.terminals.listTmuxRestoreCandidates,
    async () => {
      const liveTmuxIds = new Set(await listLocalTmuxSessionIds());
      return ctx.restoreCapabilities.list()
        .filter((capability) => capability.sessionId && liveTmuxIds.has(capability.sessionId))
        .map((capability) => ({
          capabilityId: capability.id,
          projectId: capability.request.projectId
        }));
    },
    () => []
  );
  ipcMain.handle(
    IPC.terminals.create,
    // Async: an isolated-worktree launch mints its checkout first (git is async),
    // then the resolved request flows through the SAME synchronous confined-create
    // gate. A non-worktree launch skips the git step entirely (resolver returns the
    // request unchanged), so the common path is unchanged.
    async (_e, req: CreateTerminalRequest): Promise<Result<unknown>> => {
      const resolved = await ctx.resolveWorktreeForRequest(ctx.sanitizeRendererTerminalRequest(req));
      return resolved.ok ? ctx.createInteractiveTerminal(resolved.value) : resolved;
    }
  );
  ipcMain.handle(
    IPC.terminals.restore,
    async (_e, input: { capabilityId?: string; legacyRequest?: CreateTerminalRequest }): Promise<Result<TerminalSession>> => {
      const reserved = input.capabilityId ? ctx.restoreCapabilities.reserve(input.capabilityId) : undefined;
      if (reserved) {
        const { capability, reservationId } = reserved;
        try {
          const resolved = await ctx.resolveWorktreeForRequest(capability.request);
          if (!resolved.ok) {
            ctx.restoreCapabilities.release(capability.id, reservationId);
            return resolved;
          }
          const launched = await ctx.launchAuthorizedTerminal(
            resolved.value,
            ctx.restorePrincipal(capability),
            capability.sessionId ? { preallocatedSessionId: capability.sessionId } : undefined,
            capability.request.cohort?.teamId,
            undefined,
            undefined,
            undefined,
            ctx.isTeamWorkerRestore(capability.request)
          );
          if (launched.ok) ctx.restoreCapabilities.consume(capability.id, reservationId);
          else ctx.restoreCapabilities.release(capability.id, reservationId);
          return launched;
        } catch (error) {
          ctx.restoreCapabilities.release(capability.id, reservationId);
          throw error;
        }
      }
      if (input.capabilityId) {
        return { ok: false, code: 'DENIED', message: 'restore capability unavailable or already reserved' };
      }
      if (!input.legacyRequest) {
        return { ok: false, code: 'DENIED', message: 'restore capability not found' };
      }
      const resolved = await ctx.resolveWorktreeForRequest(
        ctx.sanitizeRendererTerminalRequest(input.legacyRequest)
      );
      return resolved.ok
        ? ctx.launchAuthorizedTerminal(resolved.value, { kind: 'interactive-user', id: 'restore:legacy-confirmed' })
        : resolved;
    }
  );
  // Wake-from-sleep reconnect for a remote tab whose local `ssh` proxy died when
  // the machine slept. Re-authorizes the project (Rule 1 — the renderer supplies
  // only ids; main confirms the project exists AND is remote) and spawns a fresh
  // local pty that RE-ATTACHES the still-live `cc-<oldSessionId>` tmux session on
  // the box (attach-or-create), resuming the transcript if that session is gone.
  ipcMain.handle(
    IPC.terminals.reconnectRemote,
    async (_e, input: {
      capabilityId?: string;
      legacy?: { projectId: string; profile: LaunchProfileId; sessionId: string };
    }): Promise<Result<TerminalSession>> => {
      const legacyReconnect = !input.capabilityId && !!input.legacy;
      let reserved = input.capabilityId ? ctx.restoreCapabilities.reserve(input.capabilityId) : undefined;
      let capability = reserved?.capability;
      if (input.capabilityId && !capability) {
        return { ok: false, code: 'DENIED', message: 'reconnect capability unavailable or already reserved' };
      }
      if (!capability && input.legacy) {
        const stored = ctx.restoreCapabilities.findExitedSession(input.legacy);
        reserved = stored ? ctx.restoreCapabilities.reserve(stored.id) : undefined;
        capability = reserved?.capability;
        if (!capability) {
          return { ok: false, code: 'DENIED', message: 'legacy reconnect target not found or identity mismatch' };
        }
      }
      if (!capability) return { ok: false, code: 'DENIED', message: 'reconnect capability not found' };
      if (!reserved) return { ok: false, code: 'DENIED', message: 'reconnect capability reservation unavailable' };
      const release = () => {
        ctx.restoreCapabilities.release(capability.id, reserved.reservationId);
      };
      const project = store.listProjects().find((p) => p.id === capability.request.projectId);
      if (!project) {
        release();
        return { ok: false, code: 'NOT_FOUND', message: 'project not found' };
      }
      // Reconnect is a remote-only affordance: a local session has no detached
      // tmux agent to re-attach, so refuse rather than spawn a bogus duplicate.
      if (!project.remote) {
        release();
        return { ok: false, code: 'NOT_FOUND', message: 'project is not remote' };
      }
      if (!capability.remoteTmuxId) {
        release();
        return { ok: false, code: 'DENIED', message: 'reconnect capability has no remote tmux target' };
      }
      try {
        const launched = await ctx.launchAuthorizedTerminal(
          capability.request,
          legacyReconnect
            ? { kind: 'interactive-user', id: 'reconnect:legacy-confirmed' }
            : { kind: 'automation', id: `reconnect:${capability.id}` },
          { reconnectTmuxId: capability.remoteTmuxId, resume: true }
        );
        if (launched.ok) ctx.restoreCapabilities.consume(capability.id, reserved.reservationId);
        else release();
        return launched;
      } catch (error) {
        release();
        throw error;
      }
    }
  );
  ctx.safeHandle(
    IPC.terminals.write,
    (id: string, data: string) => ctx.ptys.write(id, data),
    () => undefined
  );
  ctx.safeHandle(
    IPC.terminals.reply,
    // Surface the delivery verdict to the renderer: `ctx.ptys.reply` returns false
    // when no live pty matches (the agent already exited), so the inbox reply
    // box can report a dead session instead of silently claiming success.
    (id: string, text: string) => ctx.ptys.reply(id, text),
    () => false
  );
  ctx.safeHandle(
    IPC.terminals.resize,
    (id: string, cols: number, rows: number) => ctx.ptys.resize(id, cols, rows),
    () => undefined
  );
  ctx.safeHandle(
    IPC.terminals.close,
    (id: string) => ctx.terminateSession(id),
    () => false
  );
  ctx.safeHandle(IPC.terminals.backlog, (id: string) => ctx.ptys.getBacklog(id), () => '');
  ctx.safeHandle(
    IPC.terminals.summarizeIdle,
    // Read-only "Summarize" board action: the agents stay RUNNING, so the digest
    // reads "Caught up on N agents", not "Closed N idle agents".
    (projectId: string, sessionIds: string[]) =>
      ctx.closeSummary.summarize(projectId, sessionIds, { closing: false }),
    () => ({ summarized: 0 })
  );
  ctx.safeHandle(
    IPC.terminals.closeFollowup,
    (projectId: string, sessionIds: string[]) =>
      ctx.closeSummary.summarizeAndFollowUp(projectId, sessionIds),
    // A failed summary/follow-up must not block the close the renderer does next.
    () => ({ summarized: 0, followedUp: 0 })
  );
  ctx.safeHandle(
    IPC.terminals.summarizeSession,
    (projectId: string, sessionId: string) => ctx.closeSummary.summarizeOne(projectId, sessionId),
    // Mirror the renderer's other failure reasons so a thrown handler still
    // toasts something sensible rather than a generic IPC error.
    () => ({ ok: false as const, reason: 'summary-failed' as const })
  );
  ctx.safeHandle(
    IPC.terminals.sessionStats,
    async (projectId: string, sessionId: string): Promise<SessionStats | null> => {
      // Rule 1: authorize from main's OWN session record, never renderer input.
      // A stale/foreign id (session died, or projectId doesn't own it) → null.
      const session = ctx.ptys.getSession(sessionId);
      if (!session) {
        const exited = ctx.exitedSessionStats.get(sessionId);
        if (!exited || exited.projectId !== projectId) return null;
        return exited.pending ? exited.pending : exited.stats;
      }
      if (session.projectId !== projectId) return null;
      return ctx.readLiveSessionStats(session);
    },
    () => null
  );
  ctx.safeHandle(
    IPC.terminals.generateCatchUpSummary,
    async (projectId: string, sessionId: string): Promise<CatchUpSummaryResult> => {
      // Re-validate that sessionId belongs to projectId (CLAUDE.md #1) before
      // reading its transcript / running the LLM. A stale/foreign id is rejected.
      const session = ctx.ptys.getSession(sessionId);
      if (!session || session.projectId !== projectId) {
        return {
          sessionId,
          projectId,
          ok: false,
          text: '',
          error: 'ineligible',
          ms: 0,
          generatedAt: Date.now(),
          trigger: 'idle'
        };
      }
      // Delegate to the service's on-demand generateOne method, which bypasses
      // the dwell timer and one-shot gate (the caller wants the latest state NOW).
      return ctx.catchUpSummary.generateOne(sessionId);
    },
    // Fallback on handler throw (should never happen — generateOne never throws).
    (): CatchUpSummaryResult => ({
      sessionId: '',
      projectId: '',
      ok: false,
      text: '',
      error: 'handler-failed',
      ms: 0,
      generatedAt: Date.now(),
      trigger: 'idle'
    })
  );
  ctx.safeHandle(
    IPC.terminals.clearAgentBlocked,
    (projectId: string, sessionId: string): boolean => {
      // Rule 1: authorize from main's OWN session record, never renderer input.
      // A stale/foreign id (session died, or projectId doesn't own it) is a no-op.
      const session = ctx.ptys.getSession(sessionId);
      if (!session || session.projectId !== projectId) return false;
      // Drop the sticky "blocked / Needs you" overlay — the same transition the
      // Stop hook performs when a turn ends. The resolved state falls back to the
      // latest OSC reading (typically idle), so the agent re-tags as Idle.
      ctx.agentStatus.clearBlocked(sessionId);
      return true;
    },
    () => false
  );
  ctx.safeHandle(
    IPC.terminals.setHeadless,
    (id: string, headless: boolean) => ctx.ptys.setHeadless(id, headless),
    () => null
  );
  ctx.safeHandle(
    IPC.terminals.setHeartbeat,
    (id: string, on: boolean) => {
      // Cancel any armed nudge immediately when turning OFF, so "off" takes
      // effect at once rather than after the live timer elapses (it would
      // self-cancel at the eligibility re-check, but a lingering timer is
      // surprising). Set the per-agent flag FIRST, then — when turning ON — arm
      // right away if the agent is already idle: the operator typically enables
      // Heartbeat on an agent they can see is already sitting idle, and
      // observe() only arms on the working→idle edge, which won't recur for an
      // already-idle session. Without this, "on" would silently never nudge.
      if (!on) ctx.heartbeat.cancel(id);
      const result = ctx.ptys.setHeartbeat(id, on);
      if (on) ctx.heartbeat.armIfIdle(id);
      return result;
    },
    () => null
  );
  ctx.safeHandle(
    IPC.terminals.setActiveSession,
    (id: string | null) => {
      // Advisory only — record which tab is foreground so auto-close-idle can
      // spare it. Never authorizes a close, so an unchecked id is harmless: a
      // forged value can only ever SPARE a session, never reach into another
      // project (Rule 1). Normalize anything non-string to null.
      ctx.activeForegroundSessionId = typeof id === 'string' ? id : null;
    },
    () => undefined
  );
  ctx.safeHandle(
    IPC.terminals.setFavorites,
    (keys: string[]) => {
      // Advisory only — record which agents the user has starred so
      // auto-close-idle can spare them. Never authorizes a close, so an unchecked
      // list is harmless: a forged key can only ever SPARE a session, never reach
      // into another project (Rule 1). Normalize anything non-array to empty.
      ctx.favoriteAgentKeys = new Set(Array.isArray(keys) ? keys.filter((k) => typeof k === 'string') : []);
      // Re-arm any now-eligible idle agent — un-starring an already-idle agent
      // should let the timer reclaim it without waiting for a working→idle cycle.
      // (armAllIdle re-checks eligibility, so a still-starred agent stays spared;
      // a newly-starred armed timer simply bails at fire via the eligible() gate.)
      ctx.autoCloseIdle.armAllIdle();
      // The popover renders a pin per starred agent — keep it in step.
      ctx.menubar?.refresh();
    },
    () => undefined
  );
  // ----- menu-bar popover (macOS frameless card; behind ctx.menubarPopoverEnabled) --
  // The popover renderer is a thin, read-only view: it asks for a snapshot on
  // mount and calls these action verbs, each authorized from main's own state
  // (Rule 1). A no-op-shaped result keeps every call safe if the controller
  // failed to construct.
  ctx.safeHandle(
    IPC.menubar.request,
    () =>
      ctx.menubar?.buildSnapshot() ?? {
        agents: [],
        needsYou: 0,
        working: 0,
        scheduleCount: 0,
        nextRunAt: null,
        theme: ctx.resolveTheme()
      },
    () => ({
      agents: [],
      needsYou: 0,
      working: 0,
      scheduleCount: 0,
      nextRunAt: null,
      theme: 'dark' as const
    })
  );
  ctx.safeHandle(
    IPC.menubar.focusSession,
    (sessionId: string, projectId: string) => {
      // Authorize from main's OWN session record — a forged pair that doesn't
      // match a live session is dropped rather than focused (Rule 1).
      const s = ctx.ptys.getSession(sessionId);
      if (!s || s.projectId !== projectId) return;
      ctx.menubar?.hide();
      ctx.showMainWindow();
      ctx.safeSend('app:focusSession', sessionId, projectId);
    },
    () => undefined
  );
  ctx.safeHandle(
    IPC.menubar.setFavorite,
    (sessionId: string, favorite: boolean) => {
      // Toggle the pin using the SAME favorite-key scheme the sidebar star uses
      // (claudeSessionId ?? id), resolved from main's session record (Rule 1).
      const s = ctx.ptys.getSession(sessionId);
      if (!s) return;
      const key = s.claudeSessionId ?? sessionId;
      if (favorite) ctx.favoriteAgentKeys.add(key);
      else ctx.favoriteAgentKeys.delete(key);
      ctx.autoCloseIdle.armAllIdle();
      // Mirror the change into the renderer's persisted star set so the sidebar
      // and popover agree and it survives relaunch.
      ctx.safeSend('app:favoritesChanged', Array.from(ctx.favoriteAgentKeys));
      ctx.menubar?.refresh();
    },
    () => undefined
  );
  ctx.safeHandle<[string, string], MenubarReplyResult>(
    IPC.menubar.reply,
    (sessionId: string, text: string) => {
      // Light-interaction WRITE path. Every gate is re-checked here from main's
      // OWN state — the popover's sessionId/text are untrusted lookup inputs,
      // never a capability (Rule 1).
      if (!ctx.menubarPopoverEnabled()) return { ok: false, reason: 'disabled' };
      const s = ctx.ptys.getSession(sessionId);
      if (!s || (s.status !== 'running' && s.status !== 'starting')) {
        return { ok: false, reason: 'ended' };
      }
      // Refuse background work — a glance-surface reply into a detached
      // scheduled/headless job (no visible terminal) would be surprising. Same
      // gate the snapshot's `repliable` hint advertises.
      if (!isRepliable(s)) return { ok: false, reason: 'background' };
      // Bound + sanitize: collapse CR/LF (the reply is ONE submission — reply()
      // appends its own Enter; embedded newlines would smuggle extra keypresses)
      // and cap the length so the write path can't be flooded from the menu bar.
      const clean = text.replace(/[\r\n]+/g, ' ').trim().slice(0, ctx.MENUBAR_REPLY_MAX_CHARS);
      if (!clean) return { ok: false, reason: 'empty' };
      const ok = ctx.ptys.reply(sessionId, clean);
      if (ok) ctx.menubar?.refresh();
      return { ok, reason: ok ? undefined : 'ended' };
    },
    () => ({ ok: false, reason: 'ended' })
  );
  ctx.safeHandle(
    IPC.menubar.open,
    (view: 'dashboard' | 'agents' | 'settings' | 'scheduler') => {
      ctx.menubar?.hide();
      ctx.showMainWindow();
      if (view === 'agents') ctx.safeSend('app:openAgents');
      else if (view === 'settings') ctx.safeSend('app:openSettings');
      else if (view === 'scheduler') ctx.safeSend('app:openScheduler');
      // 'dashboard' just shows the window (its default view).
    },
    () => undefined
  );
  ctx.safeHandle(
    IPC.menubar.hide,
    () => ctx.menubar?.hide(),
    () => undefined
  );
  ctx.safeHandle(
    IPC.menubar.quit,
    () => app.quit(),
    () => undefined
  );
  ctx.safeHandle(
    IPC.terminals.agentStatusSnapshot,
    () => ctx.agentStatus.snapshot(),
    () => []
  );
  ctx.safeHandle(
    IPC.terminals.agentStatusSince,
    (sinceSeq: number) => {
      // Validate sinceSeq in main (Rule 1) — coerce junk to 0 for a full replay/snapshot.
      if (!Number.isFinite(sinceSeq) || sinceSeq < 0) sinceSeq = 0;
      return ctx.agentStatus.since(sinceSeq);
    },
    () => ({ mode: 'snapshot' as const, snapshot: [], headSeq: 0 })
  );
  ctx.safeHandle(
    IPC.terminals.subagentSnapshot,
    () => ctx.agentStatus.subagentSnapshot(),
    () => []
  );
  ctx.safeHandle(
    IPC.terminals.subagentChildrenSnapshot,
    () => ctx.agentStatus.subagentChildSnapshot(),
    () => []
  );
}

