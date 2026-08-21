// @ts-nocheck
import { ipcMain } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { externalReject, isExternalId, listSchedulesForUi } from './shared.js';
import { store } from '@zana-ai/zcc-server/services/projects/store';
import type { FeedDigestResult, FollowUp, FollowUpCreateInput, FollowUpStatus, FollowUpUpdateInput, Goal, GoalCreateInput, GoalStatus, GoalUpdateInput, Result, ScheduleCreateInput, ScheduleGroup, ScheduleGroupInput, ScheduleUpdateInput, ScheduledTask } from '@zana-ai/zcc-domain/product';

export function registerSchedulerIpc(): void {
  

  ctx.safeHandle(IPC.scheduler.list, () => listSchedulesForUi(), () => []);
  ipcMain.handle(
    IPC.scheduler.create,
    async (_e, input: ScheduleCreateInput): Promise<Result<ScheduledTask>> => {
      try {
        if (!store.listProjects().some((project) => project.id === input.projectId)) {
          return { ok: false, code: 'UNKNOWN_PROJECT', message: `project not found: ${input.projectId}` };
        }
        return { ok: true, value: ctx.scheduler.create(input) };
      } catch (err) {
        return { ok: false, code: 'CREATE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.scheduler.update,
    async (_e, id: string, patch: ScheduleUpdateInput): Promise<Result<ScheduledTask>> => {
      if (isExternalId(id)) return externalReject();
      try {
        if (patch.projectId !== undefined && !store.listProjects().some((project) => project.id === patch.projectId)) {
          return { ok: false, code: 'UNKNOWN_PROJECT', message: `project not found: ${patch.projectId}` };
        }
        return { ok: true, value: ctx.scheduler.update(id, patch) };
      } catch (err) {
        return { ok: false, code: 'UPDATE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.scheduler.delete,
    async (_e, id: string): Promise<Result<true>> => {
      if (isExternalId(id)) return externalReject();
      try {
        ctx.scheduler.remove(id);
        return { ok: true, value: true };
      } catch (err) {
        return { ok: false, code: 'DELETE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.scheduler.setEnabled,
    async (_e, id: string, enabled: boolean): Promise<Result<ScheduledTask>> => {
      if (isExternalId(id)) return externalReject();
      try {
        const task = ctx.scheduler.setEnabled(id, enabled);
        if (!task) return { ok: false, code: 'NOT_FOUND', message: `schedule not found: ${id}` };
        return { ok: true, value: task };
      } catch (err) {
        return { ok: false, code: 'SET_ENABLED_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.scheduler.runNow,
    async (_e, id: string): Promise<Result<ScheduledTask>> => {
      if (isExternalId(id)) return externalReject();
      try {
        return { ok: true, value: ctx.scheduler.runNow(id) };
      } catch (err) {
        return { ok: false, code: 'RUN_FAILED', message: String(err) };
      }
    }
  );
  ctx.scheduler.on('changed', () => {
    ctx.safeSend(IPC.scheduler.onChanged, listSchedulesForUi());
  });

  // Goals — persistent objectives the main process works toward (spawn → evaluate
  // → re-spawn). Mirrors the ctx.scheduler IPC surface. The renderer is untrusted, so
  // create() rejects an unknown projectId here in main (Rule 1) before any loop
  // could spawn into it; the manager's own spawn path re-resolves the project.
  ctx.safeHandle(IPC.goals.list, () => ctx.goals.list(), () => []);
  ipcMain.handle(
    IPC.goals.create,
    async (_e, input: GoalCreateInput): Promise<Result<Goal>> => {
      try {
        if (!store.listProjects().some((p) => p.id === input.projectId)) {
          return { ok: false, code: 'UNKNOWN_PROJECT', message: `unknown projectId: ${input.projectId}` };
        }
        return { ok: true, value: ctx.goals.create(input) };
      } catch (err) {
        return { ok: false, code: 'CREATE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.goals.update,
    async (_e, id: string, patch: GoalUpdateInput): Promise<Result<Goal>> => {
      try {
        return { ok: true, value: ctx.goals.update(id, patch) };
      } catch (err) {
        return { ok: false, code: 'UPDATE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.goals.delete,
    async (_e, id: string): Promise<Result<true>> => {
      try {
        ctx.goals.remove(id);
        return { ok: true, value: true };
      } catch (err) {
        return { ok: false, code: 'DELETE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.goals.setStatus,
    async (_e, id: string, status: GoalStatus): Promise<Result<Goal>> => {
      try {
        const goal = ctx.goals.setStatus(id, status);
        if (!goal) return { ok: false, code: 'NOT_FOUND', message: `goal not found: ${id}` };
        return { ok: true, value: goal };
      } catch (err) {
        return { ok: false, code: 'SET_STATUS_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.goals.runNow,
    async (_e, id: string): Promise<Result<Goal>> => {
      try {
        return { ok: true, value: ctx.goals.runNow(id) };
      } catch (err) {
        return { ok: false, code: 'RUN_FAILED', message: String(err) };
      }
    }
  );
  ctx.goals.on('changed', () => {
    ctx.safeSend(IPC.goals.onChanged, ctx.goals.list());
  });

  // Follow-ups — agent-parked questions / decisions awaiting a human. Mirrors the
  // ctx.goals IPC surface (minus runNow — a follow-up has no loop to run). The
  // renderer is untrusted, so create() rejects an unknown projectId here (Rule 1).
  ctx.safeHandle(IPC.followups.list, () => ctx.followups.list(), () => []);
  ipcMain.handle(
    IPC.followups.create,
    async (_e, input: FollowUpCreateInput): Promise<Result<FollowUp>> => {
      try {
        if (!store.listProjects().some((p) => p.id === input.projectId)) {
          return { ok: false, code: 'UNKNOWN_PROJECT', message: `unknown projectId: ${input.projectId}` };
        }
        return { ok: true, value: ctx.followups.create(input) };
      } catch (err) {
        return { ok: false, code: 'CREATE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.followups.update,
    async (_e, id: string, patch: FollowUpUpdateInput): Promise<Result<FollowUp>> => {
      try {
        return { ok: true, value: ctx.followups.update(id, patch) };
      } catch (err) {
        return { ok: false, code: 'UPDATE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.followups.delete,
    async (_e, id: string): Promise<Result<true>> => {
      try {
        ctx.followups.remove(id);
        return { ok: true, value: true };
      } catch (err) {
        return { ok: false, code: 'DELETE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.followups.setStatus,
    async (_e, id: string, status: FollowUpStatus, resolution?: string): Promise<Result<FollowUp>> => {
      try {
        const followUp = ctx.followups.setStatus(id, status, resolution);
        if (!followUp) return { ok: false, code: 'NOT_FOUND', message: `follow-up not found: ${id}` };
        return { ok: true, value: followUp };
      } catch (err) {
        return { ok: false, code: 'SET_STATUS_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.followups.markSpawned,
    async (_e, id: string): Promise<Result<FollowUp>> => {
      try {
        const followUp = ctx.followups.markSpawned(id);
        if (!followUp) return { ok: false, code: 'NOT_FOUND', message: `follow-up not found: ${id}` };
        return { ok: true, value: followUp };
      } catch (err) {
        return { ok: false, code: 'MARK_SPAWNED_FAILED', message: String(err) };
      }
    }
  );
  ctx.followups.on('changed', () => {
    ctx.safeSend(IPC.followups.onChanged, ctx.followups.list());
  });

  // Activity Feed — a per-project, read-only history assembled on demand by
  // `ctx.feedService` (persisted greenfield slice + events derived from the inbox /
  // ctx.followups / ctx.goals / library stores + an on-demand `git log` snapshot). The
  // renderer is untrusted: it only supplies a projectId (validated against main's
  // own list, Rule 1) + a cursor. There is NO agent-facing write tool — every
  // writer is trusted host code. `refresh` re-reads `git log`; `list` doesn't.
  const feedProjectKnown = (projectId: string) =>
    typeof projectId === 'string' && store.listProjects().some((p) => p.id === projectId);
  ctx.safeHandle(
    IPC.feed.list,
    (projectId: string, opts?: { limit?: number; before?: number }) =>
      feedProjectKnown(projectId)
        ? ctx.feedService.list(projectId, { ...(opts ?? {}) })
        : Promise.resolve({ events: [], hasMore: false }),
    () => ({ events: [], hasMore: false })
  );
  ctx.safeHandle(
    IPC.feed.refresh,
    (projectId: string, opts?: { limit?: number }) =>
      feedProjectKnown(projectId)
        ? ctx.feedService.list(projectId, { ...(opts ?? {}), refreshGit: true })
        : Promise.resolve({ events: [], hasMore: false }),
    () => ({ events: [], hasMore: false })
  );
  ctx.safeHandle(
    IPC.feed.digest,
    (projectId: string): Promise<FeedDigestResult> =>
      feedProjectKnown(projectId)
        ? ctx.feedSummary.summarize(projectId)
        : Promise.resolve({ ok: false, reason: 'empty' }),
    (): FeedDigestResult => ({ ok: false, reason: 'summary-failed' })
  );
  ctx.feedStore.on('changed', (projectId: string) => {
    ctx.safeSend(IPC.feed.onChanged, projectId);
  });

  ctx.safeHandle(IPC.scheduler.listTemplates, () => ctx.templates.list(), () => []);
  ctx.safeHandle(
    IPC.scheduler.revealTemplatesDir,
    () => ctx.templates.revealUserDir(),
    () => ({ ok: false, path: '', message: 'Failed to reveal ctx.templates directory' })
  );
  ctx.templates.on('changed', () => {
    ctx.safeSend(IPC.scheduler.onTemplatesChanged, ctx.templates.list());
  });
ctx.safeHandle(IPC.scheduler.groupsList, () => ctx.scheduleGroups.list(), () => []);
  ipcMain.handle(
    IPC.scheduler.groupsCreate,
    async (_e, input: ScheduleGroupInput): Promise<Result<ScheduleGroup>> => {
      try {
        return { ok: true, value: ctx.scheduleGroups.create(input) };
      } catch (err) {
        return { ok: false, code: 'GROUP_CREATE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.scheduler.groupsUpdate,
    async (_e, id: string, patch: Partial<ScheduleGroupInput>): Promise<Result<ScheduleGroup>> => {
      try {
        const group = ctx.scheduleGroups.update(id, patch);
        if (!group) return { ok: false, code: 'NOT_FOUND', message: `group not found: ${id}` };
        return { ok: true, value: group };
      } catch (err) {
        return { ok: false, code: 'GROUP_UPDATE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.scheduler.groupsDelete,
    async (_e, id: string): Promise<Result<true>> => {
      try {
        const ok = ctx.scheduleGroups.delete(id);
        if (!ok) return { ok: false, code: 'NOT_FOUND', message: `group not found: ${id}` };
        return { ok: true, value: true };
      } catch (err) {
        return { ok: false, code: 'GROUP_DELETE_FAILED', message: String(err) };
      }
    }
  );
  ctx.safeHandle(
    IPC.scheduler.groupsReorder,
    (orderedIds: string[]) => ctx.scheduleGroups.reorder(orderedIds),
    () => []
  );
  ctx.scheduleGroups.on('changed', (groups: ScheduleGroup[]) => {
    ctx.safeSend(IPC.scheduler.groupsOnChanged, groups);
  });
}

