// @ts-nocheck
import { ipcMain } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { exportInboxPdf } from '../native/inbox-pdf.js';
import { runSuggestion } from '@zana-ai/zcc-server/services/suggestions/run-suggestion';
import { store } from '@zana-ai/zcc-server/services/projects/store';
import type { InboxEntry } from '@zana-ai/zcc-server';
import type { Suggestion } from '@zana-ai/zcc-server';
import type { DetailedInboxSummaryResult, FeedNoiseResult, InboxPdfExport, InboxSummaryResult } from '@zana-ai/zcc-domain/product';
import type { UsageSummary } from '@zana-ai/zcc-domain/telemetry-events';

export function registerInboxIpc(): void {
  


  // Inbox: history/delete RPCs + push subscriptions. We subscribe to the
  // store once at registration (registerIpc is called exactly once from
  // app.whenReady) and let `ctx.safeSend` no-op if the renderer isn't ready
  // yet — that way late subscribers in the renderer pick up the next
  // event without us re-binding listeners on window reactivation.
  ctx.safeHandle(
    IPC.inbox.history,
    (opts?: { limit?: number; before?: string; projectId?: string }) =>
      ctx.inboxStore.read(opts),
    () => ({ entries: [], hasMore: false })
  );
  ctx.safeHandle(
    IPC.inbox.delete,
    (id: string) => ctx.inboxStore.delete(id),
    () => false
  );
  ctx.safeHandle(
    IPC.inbox.deleteMany,
    (ids: string[]) => ctx.inboxStore.deleteMany(ids),
    () => 0
  );
  ctx.safeHandle(
    IPC.inbox.exportPdf,
    (input: InboxPdfExport) => exportInboxPdf(store.getConfig().pdfExportDir, input),
    (err) => ({ ok: false, message: err instanceof Error ? err.message : String(err) })
  );
  ctx.safeHandle(
    IPC.inbox.summarize,
    (projectId?: string | null) => ctx.inboxSummary.summarize(projectId ?? null),
    (): InboxSummaryResult => ({ ok: false, reason: 'summary-failed' })
  );
  ctx.safeHandle(
    IPC.inbox.summarizeDetailed,
    (projectId?: string | null) => ctx.inboxSummary.summarizeDetailed(projectId ?? null),
    (): DetailedInboxSummaryResult => ({ ok: false, reason: 'summary-failed' })
  );
  ctx.safeHandle(
    IPC.inbox.classifyNoise,
    (projectId?: string | null): Promise<FeedNoiseResult> => {
      // Gated in main (Rule 1): the renderer can invoke it, but the feature only
      // runs when the operator turned it on — otherwise an empty demotion set.
      if (store.getConfig().feedNoiseClassifierEnabled !== true) {
        return Promise.resolve({ routineIds: [], candidateCount: 0 });
      }
      return ctx.feedNoiseClassifier.classify(projectId ?? null);
    },
    (): FeedNoiseResult => ({ routineIds: [], candidateCount: 0 })
  );
  ctx.safeHandle(
    IPC.usage.getSummary,
    () => ctx.usageService.summarize(),
    // A failed rollup degrades to an honest empty summary (never a crash); the
    // service itself never throws, so this floor covers only an unexpected error.
    (): UsageSummary => ({
      generatedAt: Date.now(),
      sessionCount: 0,
      totalTokens: 0,
      totalPromptCount: 0,
      totalToolCalls: 0,
      totalMcpCalls: 0,
      byProject: [],
      byModel: [],
      topSessions: []
    })
  );
  ctx.inboxStore.onAppended((entry: InboxEntry) => {
    ctx.safeSend(IPC.inbox.onAppended, entry);
  });
  // Loud-tier OS presence (native Notification + dock badge) — subscribed
  // ONCE here at registerIpc (called once from bootstrap, not per
  // createWindow — Rule 3); disposed in before-quit alongside the other
  // once-registered subscriptions below.
  ctx.offLoudInboxAppended = ctx.inboxStore.onAppended(ctx.handleLoudInboxEntry);
  ctx.inboxStore.onRemoved((id: string) => {
    ctx.safeSend(IPC.inbox.onRemoved, id);
  });
  ctx.inboxStore.onUpdated((entry: InboxEntry) => {
    ctx.safeSend(IPC.inbox.onUpdated, entry);
  });
  ctx.inboxStore.onPruned((removedIds: string[]) => {
    ctx.safeSend(IPC.inbox.onPruned, removedIds);
  });

  // Suggested Actions launcher (afl-03): list/dismiss RPCs + a main-authorized
  // `run` seam + the same subscribe-once push wiring as the inbox above. `run`
  // NEVER trusts a renderer-supplied action — it reads the suggestion from
  // main's own store and re-authorizes every step (Rule 1/2), see runSuggestion.
  ctx.safeHandle(
    IPC.suggestions.list,
    (projectId?: string) => ctx.suggestionsStore.read({ projectId, limit: 200 }),
    () => ({ entries: [], hasMore: false })
  );
  ctx.safeHandle(
    IPC.suggestions.dismiss,
    (id: string) => ctx.suggestionsStore.delete(id),
    () => false
  );
  ctx.safeHandle(
    IPC.suggestions.run,
    (id: string) =>
      runSuggestion(id, {
        store: ctx.suggestionsStore,
        createTerminal: (req) =>
          ctx.launchAuthorizedTerminal(req, { kind: 'automation', id: `suggestion:${id}` }),
        listProjectIds: () => store.listProjects().map((p) => p.id)
      }),
    () => ({ ok: false })
  );
  ctx.suggestionsStore.onAppended((entry: Suggestion) => {
    ctx.safeSend(IPC.suggestions.onAppended, entry);
  });
  ctx.suggestionsStore.onRemoved((id: string) => {
    ctx.safeSend(IPC.suggestions.onRemoved, id);
  });
  ctx.suggestionsStore.onUpdated((entry: Suggestion) => {
    ctx.safeSend(IPC.suggestions.onUpdated, entry);
  });
  ctx.suggestionsStore.onPruned((removedIds: string[]) => {
    ctx.safeSend(IPC.suggestions.onPruned, removedIds);
  });
}

