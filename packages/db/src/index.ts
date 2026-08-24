export { openDatabase, type ZccDatabase, type SqliteDatabase } from './connection.js';
export { migrate } from './migrate.js';
export {
  createHostId,
  createHostSessionId,
  createEnvironmentId,
  createThreadId,
  createEventId
} from './ids.js';
export {
  getHost,
  listHosts,
  upsertHost,
  markHostSeen,
  type HostRow
} from './data/hosts.js';
export {
  getActiveSessionForHost,
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
  listVisibleConversationThreads,
  updateConversationThreadStatus,
  updateConversationThreadParent,
  setConversationProviderThreadId,
  archiveConversationThread,
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
  countConversationThreadEvents,
  listConversationThreadEvents,
  listConversationThreadEventsWindow,
  nextConversationEventSequence,
  type ConversationThreadEventRow
} from './data/conversation-events.js';
