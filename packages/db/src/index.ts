export { openDatabase, type ZccDatabase, type SqliteDatabase } from './connection.js';
export { migrate } from './migrate.js';
export {
  createHostId,
  createHostSessionId,
  createEnvironmentId,
  createThreadId,
  createEventId,
  createPendingInteractionId,
  createDeferredThreadMessageId
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
  listLiveConversationThreads,
  listLiveConversationThreadsForHost,
  listVisibleConversationThreads,
  updateConversationThreadStatus,
  updateConversationThreadParent,
  updateConversationThreadTitle,
  setConversationProviderThreadId,
  archiveConversationThread,
  unarchiveConversationThread,
  countLiveConversationThreadsForEnvironment,
  type ConversationThreadRow,
  type ConversationThreadStatus
} from './data/conversation-threads.js';
export {
  appendThreadEvent,
  listThreadEvents,
  threadOutputTail,
  nextEventSequence,
  type ThreadEventRow
} from './data/events.js';
export {
  appendConversationThreadEvent,
  copyConversationThreadEvents,
  countConversationThreadEvents,
  deleteConversationThreadEventsAfter,
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
  countDeferredThreadMessages,
  createDeferredThreadMessage,
  deleteDeferredThreadMessage,
  deleteDeferredThreadMessagesForThread,
  listDeferredThreadMessages,
  type DeferredThreadMessageRow
} from './data/deferred-thread-messages.js';
