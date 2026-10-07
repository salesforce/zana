// @ts-nocheck
import { productHandle, safeProductHandle } from './shared-product-registration.js';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { externalReject, isExternalId, listSchedulesForUi } from './shared.js';
import { store } from '@zana-ai/zcc-server/services/projects/store';
import type { FeedDigestResult, FollowUp, FollowUpCreateInput, FollowUpStatus, FollowUpUpdateInput, Goal, GoalCreateInput, GoalStatus, GoalUpdateInput, Result, ScheduleCreateInput, ScheduleGroup, ScheduleGroupInput, ScheduleUpdateInput, ScheduledTask } from '@zana-ai/zcc-domain/product';

export function registerSchedulerIpc(): void {
  for (const [channel, manager] of [[IPC.scheduler.reconcile, ctx.scheduler], [IPC.goals.reconcile, ctx.goals]] as const) {
    productHandle(channel, async (id: unknown): Promise<Result<boolean>> => {
      if (typeof id !== 'string' || !id || id.length > 256) return { ok: false, code: 'BAD_INPUT', message: 'A valid record id is required' };
      if (isExternalId(id)) return externalReject();
      try { return { ok: true, value: await manager.reconcile(id) }; }
      catch (error) { return { ok: false, code: 'RECOVERY_FAILED', message: error instanceof Error ? error.message : 'Could not check the worker' }; }
    });
  }

  safeProductHandle(IPC.scheduler.list, () => listSchedulesForUi(), () => []);
  for (const [channel, action] of [[IPC.scheduler.get, (id: string) => ctx.scheduler.get(id)], [IPC.scheduler.reload, (id: string) => ctx.scheduler.reload(id)]] as const) {
    productHandle(channel, async (id: unknown) => {
      if (typeof id !== 'string' || !id || id.length > 256) return { ok: false, code: 'BAD_INPUT', message: 'A valid schedule id is required' };
      if (isExternalId(id)) return externalReject();
      try { return { ok: true, value: await action(id) }; }
      catch (error) { return { ok: false, code: 'SCHEDULE_FAILED', message: error instanceof Error ? error.message : String(error) }; }
    });
  }
  productHandle(
    IPC.scheduler.create,
    async (input: ScheduleCreateInput): Promise<Result<ScheduledTask>> => {
      try {
        if (!store.listProjects().some((project) => project.id === input.projectId)) {
          return { ok: false, code: 'UNKNOWN_PROJECT', message: `project not found: ${input.projectId}` };
        }
        return { ok: true, value: await ctx.scheduler.create(input) };
      } catch (err) {
        return { ok: false, code: 'CREATE_FAILED', message: String(err) };
      }
    }
  );
  productHandle(
    IPC.scheduler.update,
    async (id: string, patch: ScheduleUpdateInput): Promise<Result<ScheduledTask>> => {
      if (isExternalId(id)) return externalReject();
      try {
        if (patch.projectId !== undefined && !store.listProjects().some((project) => project.id === patch.projectId)) {
          return { ok: false, code: 'UNKNOWN_PROJECT', message: `project not found: ${patch.projectId}` };
        }
        return { ok: true, value: await ctx.scheduler.update(id, patch) };
      } catch (err) {
        return { ok: false, code: 'UPDATE_FAILED', message: String(err) };
      }
    }
  );
  productHandle(
    IPC.scheduler.delete,
    async (id: string): Promise<Result<true>> => {
      if (isExternalId(id)) return externalReject();
      try {
        await ctx.scheduler.remove(id);
        return { ok: true, value: true };
      } catch (err) {
        return { ok: false, code: 'DELETE_FAILED', message: String(err) };
      }
    }
  );
  productHandle(
    IPC.scheduler.setEnabled,
    async (id: string, enabled: boolean): Promise<Result<ScheduledTask>> => {
      if (isExternalId(id)) return externalReject();
      try {
        const task = await ctx.scheduler.setEnabled(id, enabled);
        if (!task) return { ok: false, code: 'NOT_FOUND', message: `schedule not found: ${id}` };
        return { ok: true, value: task };
      } catch (err) {
        return { ok: false, code: 'SET_ENABLED_FAILED', message: String(err) };
      }
    }
  );
  productHandle(
    IPC.scheduler.runNow,
    async (id: string): Promise<Result<ScheduledTask>> => {
      if (isExternalId(id)) return externalReject();
      try {
        return { ok: true, value: await ctx.scheduler.runNow(id) };
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
  safeProductHandle(IPC.goals.list, () => ctx.goals.list(), () => []);
  productHandle(
    IPC.goals.create,
    async (input: GoalCreateInput): Promise<Result<Goal>> => {
      try {
        if (!store.listProjects().some((p) => p.id === input.projectId)) {
          return { ok: false, code: 'UNKNOWN_PROJECT', message: `unknown projectId: ${input.projectId}` };
        }
        return { ok: true, value: await ctx.goals.create(input) };
      } catch (err) {
        return { ok: false, code: 'CREATE_FAILED', message: String(err) };
      }
    }
  );
  productHandle(
    IPC.goals.update,
    async (id: string, patch: GoalUpdateInput): Promise<Result<Goal>> => {
      try {
        return { ok: true, value: await ctx.goals.update(id, patch) };
      } catch (err) {
        return { ok: false, code: 'UPDATE_FAILED', message: String(err) };
      }
    }
  );
  productHandle(
    IPC.goals.delete,
    async (id: string): Promise<Result<true>> => {
      try {
        await ctx.goals.remove(id);
        return { ok: true, value: true };
      } catch (err) {
        return { ok: false, code: 'DELETE_FAILED', message: String(err) };
      }
    }
  );
  productHandle(
    IPC.goals.setStatus,
    async (id: string, status: GoalStatus): Promise<Result<Goal>> => {
      try {
        const goal = await ctx.goals.setStatus(id, status);
        if (!goal) return { ok: false, code: 'NOT_FOUND', message: `goal not found: ${id}` };
        return { ok: true, value: goal };
      } catch (err) {
        return { ok: false, code: 'SET_STATUS_FAILED', message: String(err) };
      }
    }
  );
  productHandle(
    IPC.goals.runNow,
    async (id: string): Promise<Result<Goal>> => {
      try {
        return { ok: true, value: await ctx.goals.runNow(id) };
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
  safeProductHandle(IPC.followups.list, () => ctx.followups.list(), () => []);
  productHandle(
    IPC.followups.create,
    async (input: FollowUpCreateInput): Promise<Result<FollowUp>> => {
      try {
        if (!store.listProjects().some((p) => p.id === input.projectId)) {
          return { ok: false, code: 'UNKNOWN_PROJECT', message: `unknown projectId: ${input.projectId}` };
        }
        return { ok: true, value: await ctx.followups.create(input) };
      } catch (err) {
        return { ok: false, code: 'CREATE_FAILED', message: String(err) };
      }
    }
  );
  productHandle(
    IPC.followups.update,
    async (id: string, patch: FollowUpUpdateInput): Promise<Result<FollowUp>> => {
      try {
        return { ok: true, value: await ctx.followups.update(id, patch) };
      } catch (err) {
        return { ok: false, code: 'UPDATE_FAILED', message: String(err) };
      }
    }
  );
  productHandle(
    IPC.followups.delete,
    async (id: string): Promise<Result<true>> => {
      try {
        await ctx.followups.remove(id);
        return { ok: true, value: true };
      } catch (err) {
        return { ok: false, code: 'DELETE_FAILED', message: String(err) };
      }
    }
  );
  productHandle(
    IPC.followups.setStatus,
    async (id: string, status: FollowUpStatus, resolution?: string): Promise<Result<FollowUp>> => {
      try {
        const followUp = await ctx.followups.setStatus(id, status, resolution);
        if (!followUp) return { ok: false, code: 'NOT_FOUND', message: `follow-up not found: ${id}` };
        return { ok: true, value: followUp };
      } catch (err) {
        return { ok: false, code: 'SET_STATUS_FAILED', message: String(err) };
      }
    }
  );
  productHandle(
    IPC.followups.markSpawned,
    async (id: string): Promise<Result<FollowUp>> => {
      try {
        const followUp = await ctx.followups.markSpawned(id);
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
  safeProductHandle(
    IPC.feed.list,
    (projectId: string, opts?: { limit?: number; before?: number }) =>
      feedProjectKnown(projectId)
        ? ctx.feedService.list(projectId, { ...(opts ?? {}) })
        : Promise.resolve({ events: [], hasMore: false }),
    () => ({ events: [], hasMore: false })
  );
  safeProductHandle(
    IPC.feed.refresh,
    (projectId: string, opts?: { limit?: number }) =>
      feedProjectKnown(projectId)
        ? ctx.feedService.list(projectId, { ...(opts ?? {}), refreshGit: true })
        : Promise.resolve({ events: [], hasMore: false }),
    () => ({ events: [], hasMore: false })
  );
  safeProductHandle(
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

  safeProductHandle(IPC.scheduler.listTemplates, () => ctx.templates.list(), () => []);
  safeProductHandle(
    IPC.scheduler.revealTemplatesDir,
    () => ctx.templates.revealUserDir(),
    () => ({ ok: false, path: '', message: 'Failed to reveal ctx.templates directory' })
  );
  ctx.templates.on('changed', () => {
    ctx.safeSend(IPC.scheduler.onTemplatesChanged, ctx.templates.list());
  });
safeProductHandle(IPC.scheduler.groupsList, () => ctx.scheduleGroups.list(), () => []);
  productHandle(
    IPC.scheduler.groupsCreate,
    async (input: ScheduleGroupInput): Promise<Result<ScheduleGroup>> => {
      try {
        return { ok: true, value: ctx.scheduleGroups.create(input) };
      } catch (err) {
        return { ok: false, code: 'GROUP_CREATE_FAILED', message: String(err) };
      }
    }
  );
  productHandle(
    IPC.scheduler.groupsUpdate,
    async (id: string, patch: Partial<ScheduleGroupInput>): Promise<Result<ScheduleGroup>> => {
      try {
        const group = ctx.scheduleGroups.update(id, patch);
        if (!group) return { ok: false, code: 'NOT_FOUND', message: `group not found: ${id}` };
        return { ok: true, value: group };
      } catch (err) {
        return { ok: false, code: 'GROUP_UPDATE_FAILED', message: String(err) };
      }
    }
  );
  productHandle(
    IPC.scheduler.groupsDelete,
    async (id: string): Promise<Result<true>> => {
      try {
        const ok = ctx.scheduleGroups.delete(id);
        if (!ok) return { ok: false, code: 'NOT_FOUND', message: `group not found: ${id}` };
        return { ok: true, value: true };
      } catch (err) {
        return { ok: false, code: 'GROUP_DELETE_FAILED', message: String(err) };
      }
    }
  );
  safeProductHandle(
    IPC.scheduler.groupsReorder,
    (orderedIds: string[]) => ctx.scheduleGroups.reorder(orderedIds),
    () => []
  );
  ctx.scheduleGroups.on('changed', (groups: ScheduleGroup[]) => {
    ctx.safeSend(IPC.scheduler.groupsOnChanged, groups);
  });
}
