import {
  CONVERSATION_PRUNING_POLICIES, compactArchivedConversations, maintainConversationHistory, maintainConversationEventHistory,
  reclaimFreeDatabasePages, type ConversationPruningPolicy, type ZccDatabase
} from '@zana-ai/zcc-db';

const IDLE_INTERVAL_MS = 30_000;
const CATCH_UP_INTERVAL_MS = 1;

export function startConversationHistoryMaintenance(db: ZccDatabase): () => void {
  let stopped = false;
  let jobs: Array<'outputs' | 'archive' | 'vacuum' | ConversationPruningPolicy> = [];
  let timer: ReturnType<typeof setTimeout>;
  function schedule(delay: number) {
    timer = setTimeout(visit, delay);
    timer.unref();
  }
  function visit() {
    if (stopped) return;
    if (jobs.length === 0) jobs = ['outputs', ...CONVERSATION_PRUNING_POLICIES, 'archive', 'vacuum'];
    const job = jobs.shift()!;
    try {
      // Each callback advances just one existing bounded database batch and
      // yields before the next. Completed policies stay out until the next
      // sweep, so a slow policy cannot repeatedly rescan an idle one.
      if (job === 'outputs') {
        const result = maintainConversationHistory(db);
        if (result.outputs === 32 || result.scannedSnapshots === 32) jobs.push(job);
      } else if (job === 'archive') {
        if (compactArchivedConversations(db).threadId !== null) jobs.push(job);
      } else if (job === 'vacuum') {
        // Runs last, so it returns pages the sweep just freed. A no-op unless
        // the database uses incremental auto-vacuum.
        if (reclaimFreeDatabasePages(db) > 0) jobs.push(job);
      } else {
        const result = maintainConversationEventHistory(db, job)[0];
        if (result.threadId !== null) jobs.push(job);
      }
    } catch (error) {
      console.warn('[history] maintenance deferred:', error instanceof Error ? error.message : 'database unavailable');
      jobs = [];
    }
    if (!stopped) schedule(jobs.length > 0 ? CATCH_UP_INTERVAL_MS : IDLE_INTERVAL_MS);
  }
  schedule(IDLE_INTERVAL_MS);
  return () => { stopped = true; clearTimeout(timer); jobs = []; };
}
