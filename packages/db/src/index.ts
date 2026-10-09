export { openDatabase, type ZccDatabase, type SqliteDatabase } from './connection.js';
export { SQLITE_LOCK_WAIT_MS, isSqliteBusy, retrySqliteTransaction } from './contention.js';
export { createSqliteDatabase, sqliteWorkerConfiguration } from './sqlite.js';
export { migrate } from './migrate.js';
export {
  getProviderModelCatalog,
  putProviderModelCatalog,
  type ProviderModelCatalogKey,
  type StoredProviderModelCatalog
} from './data/provider-model-catalogs.js';
export { conversationTimelineWindowStart, hasConversationEventsBefore, conversationEventCursorExists, conversationTimelineHeadEvents } from './data/conversation-events.js';
export { hydrateConversationOutputs, maintainConversationHistory, CONVERSATION_OUTPUT_RETENTION_MS } from './data/conversation-output.js';
export { maintainConversationEventHistory, CONVERSATION_PRUNING_POLICIES, CONVERSATION_PRUNING_BATCH_SIZE } from './data/conversation-pruning.js';
export type { ConversationPruningPolicy } from './data/conversation-pruning.js';
export {
  compactArchivedConversations, reclaimFreeDatabasePages,
  ARCHIVED_CONVERSATION_LOG_TYPES, ARCHIVED_CONVERSATION_KEPT_ITEM_KINDS
} from './data/conversation-archive-retention.js';
export type { ArchivedConversationCompactionResult } from './data/conversation-archive-retention.js';
export {
  createHostId,
  createHostSessionId,
  createEnvironmentId,
  createThreadId,
  createEventId,
  createPendingInteractionId,
  createDeferredThreadMessageId,
  createThreadPlanId,
  createThreadPlanRevisionId,
  createThreadPlanTaskId,
  createThreadPlanReferenceId
} from './ids.js';
export {
  getHost,
  listHosts,
  getPrimaryHost,
  upsertHost,
  markHostSeen,
  renameHost,
  updateHostPermissionCeiling,
  updateHostSshIdentity,
  updateHostDefaultWorkspacePath,
  findHostBySsh,
  markHostProtocolRejected,
  destroyHost,
  type HostRow,
  type HostPermissionMode
} from './data/hosts.js';
export {
  getActiveSessionForHost,
  getLatestSessionForHost,
  openHostSession,
  closeHostSession,
  type HostSessionRow
} from './data/host-sessions.js';
export {
  countLiveThreadsForEnvironment,
  createEnvironment,
  findForeignManagedEnvironmentAtHostPath,
  findProjectEnvironmentByHostPath,
  getEnvironment,
  hasLiveThreadAtHostPath,
  listEnvironmentsByProject,
  updateEnvironmentDiscovery,
  updateEnvironmentStatus,
  type EnvironmentRow,
  type EnvironmentStatus,
  type WorkspaceProvisionType
} from './data/environments.js';
export {
  createThread,
  getThread,
  listThreadsByProject,
  listThreadsByHost,
  listLiveThreads,
  updateThreadStatus,
  completeThread,
  disconnectLiveThreadsForHost,
  type ThreadRow,
  type ThreadStatus
} from './data/threads.js';
export {
  createConversationThread,
  getConversationThread,
  listConversationThreadsByProject,
  countConversationThreadsForQuit,
  listLiveConversationThreads,
  listLiveConversationThreadsForHost,
  listConversationThreadsForHost,
  listVisibleConversationThreads,
  listMenubarConversationThreads,
  queryConversationThreads,
  updateConversationThreadStatus,
  applyConversationThreadLifecycleEvent,
  applyConversationThreadLifecycleEventOnRow,
  updateConversationThreadParent,
  updateConversationThreadTitle,
  setConversationProviderThreadId,
  archiveConversationThread,
  unarchiveConversationThread,
  pinConversationThread,
  unpinConversationThread,
  reorderPinnedConversationThread,
  countLiveConversationThreadsForEnvironment,
  type ConversationThreadRow,
  type ConversationThreadListQuery,
  type ConversationThreadStatus,
  type ApplyConversationThreadLifecycleEventOutcome,
  type ApplyConversationThreadLifecycleEventArgs
} from './data/conversation-threads.js';
export {
  appendThreadEvent,
  listThreadEvents,
  threadOutputTail,
  nextEventSequence,
  type ThreadEventRow
} from './data/events.js';
export { getConversationThreadActivityCounts, listConversationActiveTurnInputs, ACTIVE_PLAN_INPUT_PAGE_SIZE } from './data/conversation-activity.js';
export { getLatestConversationCheckpoint } from './data/conversation-checkpoint.js';
export {
  appendConversationThreadEvent,
  copyConversationThreadEvents,
  countConversationThreadEvents,
  deleteConversationThreadEventsAfter,
  getConversationTurnStart,
  getConversationThreadEventAfter,
  ConversationHistoryReadLimitError,
  CONVERSATION_EVENT_READ_MAX_BYTES,
  CONVERSATION_EVENT_READ_MAX_ROWS,
  listConversationThreadEvents,
  listConversationThreadEventsWindow,
  maxConversationEventSequenceByThreadIds,
  nextConversationEventSequence,
  remapConversationEventPayloadThreadId,
  type ConversationThreadEventRow
} from './data/conversation-events.js';
export {
  createPendingInteraction,
  getActivePendingInteractionForThread,
  getPendingInteraction,
  getPendingInteractionByProviderRequest,
  hasPendingInteractionForThread,
  interruptPendingInteractionsForPlugin,
  interruptPendingInteractionsForThreadIds,
  interruptPendingInteractionsForThreads,
  listActivePendingInteractionThreadIdsForHost,
  listActivePendingInteractionsForPlugin,
  listActivePluginPendingInteractions,
  listPendingInteractionsByThread,
  setPendingInteractionInterrupted,
  setPendingInteractionResolved,
  setPendingInteractionResolving,
  type CreatePendingInteractionInput,
  type PendingInteractionOriginKind,
  type PendingInteractionRow,
  type PendingInteractionStatus
} from './data/pending-interactions.js';
export {
  DEFERRED_THREAD_MESSAGE_CAP,
  DEFERRED_RETRY_DELAYS_MS,
  countActiveConversationTurns,
  countDeferredThreadMessages,
  createDeferredThreadMessage,
  deleteDeferredThreadMessage,
  deleteDeferredThreadMessagesForThread,
  getDeferredThreadMessage,
  isThreadQueueAutoSendPaused,
  listDeferredThreadMessages,
  listDueDeferredThreadMessages,
  listRetryableDeferredThreadMessages,
  retryDeferredThreadMessage,
  postponeDeferredThreadRetry,
  recoverInterruptedDeferredThreadMessages,
  markDeferredThreadMessageDispatching,
  holdDeferredThreadMessage,
  markDeferredThreadMessageFailed,
  pauseDeferredThreadMessagesForThread,
  requeueDeferredThreadMessagesForThread,
  resumeDeferredThreadMessagesForThread,
  type DeferredThreadMessageRow,
  type NextTurnSendStatus
} from './data/deferred-thread-messages.js';
export {
  clearDispatchAdmissionGeneration,
  consumeDispatchAdmissionOverride,
  getDispatchAdmissionGeneration,
  recordDispatchAdmissionWait,
  type DispatchAdmissionGenerationRow
} from './data/dispatch-admission-generations.js';
export {
  addThreadPlanReference,
  appendThreadPlanRevision,
  createThreadPlan,
  createThreadPlanTask,
  deleteProviderThreadPlanTask,
  getThreadExecutionState,
  getThreadPlan,
  getThreadPlanByRootThread,
  getThreadPlanTask,
  latestThreadPlanRevision,
  listThreadPlanReferences,
  listThreadPlanRevisions,
  listThreadPlanTasks,
  touchThreadPlan,
  updateThreadPlanFilePath,
  updateThreadPlanTask,
  upsertThreadExecutionState,
  type ThreadExecutionStateRow,
  type ThreadPlanReferenceRow,
  type ThreadPlanRevisionRow,
  type ThreadPlanRow,
  type ThreadPlanStatus,
  type ThreadPlanTaskOwnerKind,
  type ThreadPlanTaskRow,
  type ThreadPlanTaskStatus
} from './data/thread-plans.js';
export {
  getThreadTabs,
  replaceThreadTabs,
  type ThreadTabsRow
} from './data/thread-tabs.js';
export {
  getThreadPluginMetadata,
  insertThreadPluginMetadata,
  listThreadPluginMetadataRows,
  patchThreadPluginMetadata,
  type ThreadPluginMetadataPatch,
  type ThreadPluginMetadataPatchResult,
  type ThreadPluginMetadataRead
} from './data/thread-plugin-metadata.js';

export { listUserPromptHistory, userPromptHistoryQuery, formatUserPromptHistoryRows, type PromptHistoryCursor, type StoredPromptHistoryRow } from "./data/conversation-prompt-history.js";
