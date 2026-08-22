import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import type { CcApi } from '@zana-ai/zcc-desktop-contract';

// `ipcRenderer` is a single process-wide EventEmitter shared by every subscriber
// in the renderer. High-fan-out channels — chiefly `terminals:onData`/`onExit`,
// which each mounted terminal tab subscribes to (plus the app-level, workspace,
// and per-extension-panel subscribers) — routinely cross Node's default cap of
// 10 concurrent listeners, emitting a spurious MaxListenersExceededWarning even
// though every subscriber cleans up on unmount. Raise the cap once here to match
// the concurrent-tab reality (mirrors the `setMaxListeners(50)` convention used
// across the main-side stores).
ipcRenderer.setMaxListeners(50);
import type {
  AgentMessage,
  AgentState,
  AppConfig,
  AutonomousRun,
  CatchUpSummaryResult,
  CreateTerminalRequest,
  ExtensionEntry,
  IdleTriageResult,
  InboxEntry,
  LibraryDoc,
  OverseerActivity,
  LlmPromptEntry,
  McpServerEntry,
  MenubarSnapshot,
  Persona,
  PluginAppEntry,
  PluginEntry,
  Project,
  QuickPrompt,
  SubagentChild,
  SavedRecord,
  Suggestion,
  Team,
  TerminalSession,
  UpdateProgress,
  UpdateStatus,
  ReleaseNote,
  WhatsNewEvent,
  SetupStatus,
  DependencyProgress
} from '@zana-ai/zcc-domain/product';

const api: CcApi = {
  startup: {
    state: () => ipcRenderer.invoke(IPC.startup.state),
    retry: () => ipcRenderer.invoke(IPC.startup.retry),
    diagnostics: () => ipcRenderer.invoke(IPC.startup.diagnostics),
    quit: () => ipcRenderer.invoke(IPC.startup.quit)
  },
  projectSettings: {
    get: (id) => ipcRenderer.invoke(IPC.projectSettings.get, id),
    set: (id, patch) => ipcRenderer.invoke(IPC.projectSettings.set, id, patch),
    onChanged: (callback) => {
      const handler = (_event: unknown, projectId: string) => callback(projectId);
      ipcRenderer.on(IPC.projectSettings.onChanged, handler);
      return () => ipcRenderer.off(IPC.projectSettings.onChanged, handler);
    }
  },
  executionConsent: {
    listProject: (projectId) => ipcRenderer.invoke(IPC.executionConsent.listProject, projectId),
    revokeProject: (projectId, grantId) =>
      ipcRenderer.invoke(IPC.executionConsent.revokeProject, projectId, grantId)
  },
  harnessAuth: {
    status: () => ipcRenderer.invoke(IPC.harnessAuth.status),
    set: (key, patch) => ipcRenderer.invoke(IPC.harnessAuth.set, key, patch)
  },
  harness: {
    verify: () => ipcRenderer.invoke(IPC.harness.verify),
    descriptors: () => ipcRenderer.invoke(IPC.harness.descriptors),
    agentDescriptors: (projectId, profile, refresh = false) =>
      ipcRenderer.invoke(IPC.harness.agentDescriptors, projectId, profile, refresh === true),
    effectiveDefault: (projectId) => ipcRenderer.invoke(IPC.harness.effectiveDefault, projectId)
  },
  editor: {
    verify: () => ipcRenderer.invoke(IPC.editor.verify)
  },
  projects: {
    list: () => ipcRenderer.invoke(IPC.projects.list),
    add: (path) => ipcRenderer.invoke(IPC.projects.add, path),
    remove: (id) => ipcRenderer.invoke(IPC.projects.remove, id),
    update: (id, patch) => ipcRenderer.invoke(IPC.projects.update, id, patch),
    touch: (id) => ipcRenderer.invoke(IPC.projects.touch, id),
    reorder: (orderedIds) => ipcRenderer.invoke(IPC.projects.reorder, orderedIds),
    pickDirectory: () => ipcRenderer.invoke(IPC.projects.pickDirectory),
    addRemote: (input) => ipcRenderer.invoke(IPC.projects.addRemote, input),
    clone: (input) => ipcRenderer.invoke(IPC.projects.clone, input),
    cloneRoot: () => ipcRenderer.invoke(IPC.projects.cloneRoot),
    onCloneProgress: (cb) => {
      const handler = (_e: unknown, line: string) => cb(line);
      ipcRenderer.on(IPC.projects.cloneProgress, handler);
      return () => ipcRenderer.off(IPC.projects.cloneProgress, handler);
    },
    ensureQuickAgent: () => ipcRenderer.invoke(IPC.projects.ensureQuickAgent),
    onChanged: (cb) => {
      const handler = (_e: unknown, projects: Project[]) => cb(projects);
      ipcRenderer.on(IPC.projects.onChanged, handler);
      return () => ipcRenderer.off(IPC.projects.onChanged, handler);
    }
  },
  ssh: {
    listHosts: () => ipcRenderer.invoke(IPC.ssh.listHosts),
    syncHosts: () => ipcRenderer.invoke(IPC.ssh.syncHosts)
  },
  terminals: {
    list: (projectId) => ipcRenderer.invoke(IPC.terminals.list, projectId),
    verifyTmux: () => ipcRenderer.invoke(IPC.terminals.verifyTmux),
    listTmuxRestoreCandidates: () => ipcRenderer.invoke(IPC.terminals.listTmuxRestoreCandidates),
    create: (req: CreateTerminalRequest) => ipcRenderer.invoke(IPC.terminals.create, req),
    restore: (input) => ipcRenderer.invoke(IPC.terminals.restore, input),
    reconnectRemote: (input) => ipcRenderer.invoke(IPC.terminals.reconnectRemote, input),
    write: (id, data) => ipcRenderer.invoke(IPC.terminals.write, id, data),
    reply: (id, text) => ipcRenderer.invoke(IPC.terminals.reply, id, text),
    resize: (id, cols, rows) => ipcRenderer.invoke(IPC.terminals.resize, id, cols, rows),
    close: (id) => ipcRenderer.invoke(IPC.terminals.close, id),
    backlog: (id) => ipcRenderer.invoke(IPC.terminals.backlog, id),
    summarizeIdle: (projectId, sessionIds) =>
      ipcRenderer.invoke(IPC.terminals.summarizeIdle, projectId, sessionIds),
    summarizeSession: (projectId, sessionId) =>
      ipcRenderer.invoke(IPC.terminals.summarizeSession, projectId, sessionId),
    closeFollowup: (projectId, sessionIds) =>
      ipcRenderer.invoke(IPC.terminals.closeFollowup, projectId, sessionIds),
    sessionStats: (projectId, sessionId) =>
      ipcRenderer.invoke(IPC.terminals.sessionStats, projectId, sessionId),
    setHeadless: (id, headless) =>
      ipcRenderer.invoke(IPC.terminals.setHeadless, id, headless),
    setHeartbeat: (id, on) =>
      ipcRenderer.invoke(IPC.terminals.setHeartbeat, id, on),
    setActiveSession: (id) =>
      ipcRenderer.invoke(IPC.terminals.setActiveSession, id),
    setFavorites: (keys) =>
      ipcRenderer.invoke(IPC.terminals.setFavorites, keys),
    agentStatusSnapshot: () => ipcRenderer.invoke(IPC.terminals.agentStatusSnapshot),
    agentStatusSince: (sinceSeq: number) =>
      ipcRenderer.invoke(IPC.terminals.agentStatusSince, sinceSeq),
    subagentSnapshot: () => ipcRenderer.invoke(IPC.terminals.subagentSnapshot),
    subagentChildrenSnapshot: () => ipcRenderer.invoke(IPC.terminals.subagentChildrenSnapshot),
    onData: (cb) => {
      const handler = (_e: unknown, id: string, data: string) => cb(id, data);
      ipcRenderer.on(IPC.terminals.onData, handler);
      return () => ipcRenderer.off(IPC.terminals.onData, handler);
    },
    onExit: (cb) => {
      const handler = (_e: unknown, id: string, code: number) => cb(id, code);
      ipcRenderer.on(IPC.terminals.onExit, handler);
      return () => ipcRenderer.off(IPC.terminals.onExit, handler);
    },
    onWake: (cb) => {
      const handler = () => cb();
      ipcRenderer.on(IPC.terminals.onWake, handler);
      return () => ipcRenderer.off(IPC.terminals.onWake, handler);
    },
    onTitle: (cb) => {
      const handler = (_e: unknown, id: string, title: string, source?: 'osc' | 'llm') =>
        cb(id, title, source);
      ipcRenderer.on(IPC.terminals.onTitle, handler);
      return () => ipcRenderer.off(IPC.terminals.onTitle, handler);
    },
    onUpdated: (cb) => {
      const handler = (_e: unknown, session: TerminalSession) => cb(session);
      ipcRenderer.on(IPC.terminals.onUpdated, handler);
      return () => ipcRenderer.off(IPC.terminals.onUpdated, handler);
    },
    onAgentStatus: (cb) => {
      const handler = (_e: unknown, id: string, state: AgentState, seq: number) =>
        cb(id, state, seq);
      ipcRenderer.on(IPC.terminals.onAgentStatus, handler);
      return () => ipcRenderer.off(IPC.terminals.onAgentStatus, handler);
    },
    onSubagents: (cb) => {
      const handler = (_e: unknown, id: string, count: number) => cb(id, count);
      ipcRenderer.on(IPC.terminals.onSubagents, handler);
      return () => ipcRenderer.off(IPC.terminals.onSubagents, handler);
    },
    onSubagentChildren: (cb) => {
      const handler = (_e: unknown, id: string, children: SubagentChild[]) => cb(id, children);
      ipcRenderer.on(IPC.terminals.onSubagentChildren, handler);
      return () => ipcRenderer.off(IPC.terminals.onSubagentChildren, handler);
    },
    onIdleTriage: (cb) => {
      const handler = (_e: unknown, result: IdleTriageResult) => cb(result);
      ipcRenderer.on(IPC.terminals.onIdleTriage, handler);
      return () => ipcRenderer.off(IPC.terminals.onIdleTriage, handler);
    },
    onCatchUpSummary: (cb) => {
      const handler = (_e: unknown, result: CatchUpSummaryResult) => cb(result);
      ipcRenderer.on(IPC.terminals.onCatchUpSummary, handler);
      return () => ipcRenderer.off(IPC.terminals.onCatchUpSummary, handler);
    },
    generateCatchUpSummary: (projectId, sessionId) =>
      ipcRenderer.invoke(IPC.terminals.generateCatchUpSummary, projectId, sessionId),
    clearAgentBlocked: (projectId, sessionId) =>
      ipcRenderer.invoke(IPC.terminals.clearAgentBlocked, projectId, sessionId),
    onOverseerActivity: (cb) => {
      const handler = (_e: unknown, activity: OverseerActivity) => cb(activity);
      ipcRenderer.on(IPC.terminals.onOverseerActivity, handler);
      return () => ipcRenderer.off(IPC.terminals.onOverseerActivity, handler);
    }
  },
  config: {
    get: () => ipcRenderer.invoke(IPC.config.get),
    set: (patch) => ipcRenderer.invoke(IPC.config.set, patch),
    onChanged: (cb) => {
      const handler = (_e: unknown, config: AppConfig) => cb(config);
      ipcRenderer.on(IPC.config.onChanged, handler);
      return () => ipcRenderer.off(IPC.config.onChanged, handler);
    }
  },
  overseer: {
    recent: (limit) => ipcRenderer.invoke(IPC.overseer.recent, limit)
  },
  claude: {
    listSessions: (projectId) => ipcRenderer.invoke(IPC.claude.listSessions, projectId)
  },
  opencode: {
    listSessions: (projectId) => ipcRenderer.invoke(IPC.opencode.listSessions, projectId)
  },
  history: {
    start: (input) => ipcRenderer.invoke(IPC.history.start, input),
    refresh: (snapshotId) => ipcRenderer.invoke(IPC.history.refresh, snapshotId),
    page: (snapshotId, opaquePageCursor) => ipcRenderer.invoke(IPC.history.page, snapshotId, opaquePageCursor),
    release: (snapshotId) => ipcRenderer.invoke(IPC.history.release, snapshotId),
    resume: (snapshotId, historyId) => ipcRenderer.invoke(IPC.history.resume, snapshotId, historyId)
  },
  fs: {
    pickFiles: () => ipcRenderer.invoke(IPC.fs.pickFiles),
    listDir: (path) => ipcRenderer.invoke(IPC.fs.listDir, path),
    readFile: (path) => ipcRenderer.invoke(IPC.fs.readFile, path),
    resolveDoc: (root, reportedPath, originCwd) =>
      ipcRenderer.invoke(IPC.fs.resolveDoc, root, reportedPath, originCwd),
    writeFile: (path, content) => ipcRenderer.invoke(IPC.fs.writeFile, path, content),
    walkFiles: (path) => ipcRenderer.invoke(IPC.fs.walkFiles, path),
    searchFiles: (path, query, opts) =>
      ipcRenderer.invoke(IPC.fs.searchFiles, path, query, opts),
    readDataUrl: (path) => ipcRenderer.invoke(IPC.fs.readDataUrl, path),
    createFile: (root, path) => ipcRenderer.invoke(IPC.fs.createFile, root, path),
    createDir: (root, path) => ipcRenderer.invoke(IPC.fs.createDir, root, path),
    rename: (root, from, to) => ipcRenderer.invoke(IPC.fs.rename, root, from, to),
    delete: (root, path) => ipcRenderer.invoke(IPC.fs.delete, root, path),
    remoteRoot: (projectId) => ipcRenderer.invoke(IPC.fs.remoteRoot, projectId),
    listDirRemote: (projectId, path) => ipcRenderer.invoke(IPC.fs.listDirRemote, projectId, path),
    readFileRemote: (projectId, path) => ipcRenderer.invoke(IPC.fs.readFileRemote, projectId, path),
    writeFileRemote: (projectId, path, content) => ipcRenderer.invoke(IPC.fs.writeFileRemote, projectId, path, content),
    createFileRemote: (projectId, path) => ipcRenderer.invoke(IPC.fs.createFileRemote, projectId, path),
    createDirRemote: (projectId, path) => ipcRenderer.invoke(IPC.fs.createDirRemote, projectId, path),
    renameRemote: (projectId, from, to) => ipcRenderer.invoke(IPC.fs.renameRemote, projectId, from, to),
    deleteRemote: (projectId, path) => ipcRenderer.invoke(IPC.fs.deleteRemote, projectId, path),
    uploadToRemote: (projectId, localPath, destDir) =>
      ipcRenderer.invoke(IPC.fs.uploadToRemote, projectId, localPath, destDir),
    downloadFromRemote: (projectId, remotePath) =>
      ipcRenderer.invoke(IPC.fs.downloadFromRemote, projectId, remotePath)
  },
  openers: {
    openIn: (target, path) => ipcRenderer.invoke(IPC.openers.openIn, target, path)
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke(IPC.clipboard.writeText, text)
  },
  git: {
    status: (path, scope) => ipcRenderer.invoke(IPC.git.status, path, scope),
    showHead: (path) => ipcRenderer.invoke(IPC.git.showHead, path),
    discard: (path) => ipcRenderer.invoke(IPC.git.discard, path),
    previewCommit: (projectId) => ipcRenderer.invoke(IPC.git.previewCommit, projectId),
    commitProject: (previewId, message) => ipcRenderer.invoke(IPC.git.commitProject, previewId, message),
    pushProject: (projectId) => ipcRenderer.invoke(IPC.git.pushProject, projectId),
    isRepo: (path) => ipcRenderer.invoke(IPC.git.isRepo, path),
    listWorktrees: (path) => ipcRenderer.invoke(IPC.git.listWorktrees, path),
    listBranches: (path) => ipcRenderer.invoke(IPC.git.listBranches, path),
    removeWorktree: (projectPath, worktreePath, force) =>
      ipcRenderer.invoke(IPC.git.removeWorktree, projectPath, worktreePath, force)
  },
  files: {
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  inbox: {
    history: (opts) => ipcRenderer.invoke(IPC.inbox.history, opts),
    delete: (id) => ipcRenderer.invoke(IPC.inbox.delete, id),
    deleteMany: (ids) => ipcRenderer.invoke(IPC.inbox.deleteMany, ids),
    exportPdf: (input) => ipcRenderer.invoke(IPC.inbox.exportPdf, input),
    summarize: (projectId) => ipcRenderer.invoke(IPC.inbox.summarize, projectId ?? null),
    summarizeDetailed: (projectId) =>
      ipcRenderer.invoke(IPC.inbox.summarizeDetailed, projectId ?? null),
    classifyNoise: (projectId) => ipcRenderer.invoke(IPC.inbox.classifyNoise, projectId ?? null),
    onAppended: (cb) => {
      const handler = (_e: unknown, entry: InboxEntry) => cb(entry);
      ipcRenderer.on(IPC.inbox.onAppended, handler);
      return () => ipcRenderer.off(IPC.inbox.onAppended, handler);
    },
    onRemoved: (cb) => {
      const handler = (_e: unknown, id: string) => cb(id);
      ipcRenderer.on(IPC.inbox.onRemoved, handler);
      return () => ipcRenderer.off(IPC.inbox.onRemoved, handler);
    },
    onUpdated: (cb) => {
      const handler = (_e: unknown, entry: InboxEntry) => cb(entry);
      ipcRenderer.on(IPC.inbox.onUpdated, handler);
      return () => ipcRenderer.off(IPC.inbox.onUpdated, handler);
    },
    onPruned: (cb) => {
      const handler = (_e: unknown, ids: string[]) => cb(ids);
      ipcRenderer.on(IPC.inbox.onPruned, handler);
      return () => ipcRenderer.off(IPC.inbox.onPruned, handler);
    }
  },
  usage: {
    getSummary: () => ipcRenderer.invoke(IPC.usage.getSummary)
  },
  suggestions: {
    list: (projectId) => ipcRenderer.invoke(IPC.suggestions.list, projectId ?? undefined),
    dismiss: (id) => ipcRenderer.invoke(IPC.suggestions.dismiss, id),
    run: (id) => ipcRenderer.invoke(IPC.suggestions.run, id),
    onAppended: (cb) => {
      const handler = (_e: unknown, entry: Suggestion) => cb(entry);
      ipcRenderer.on(IPC.suggestions.onAppended, handler);
      return () => ipcRenderer.off(IPC.suggestions.onAppended, handler);
    },
    onRemoved: (cb) => {
      const handler = (_e: unknown, id: string) => cb(id);
      ipcRenderer.on(IPC.suggestions.onRemoved, handler);
      return () => ipcRenderer.off(IPC.suggestions.onRemoved, handler);
    },
    onUpdated: (cb) => {
      const handler = (_e: unknown, entry: Suggestion) => cb(entry);
      ipcRenderer.on(IPC.suggestions.onUpdated, handler);
      return () => ipcRenderer.off(IPC.suggestions.onUpdated, handler);
    },
    onPruned: (cb) => {
      const handler = (_e: unknown, ids: string[]) => cb(ids);
      ipcRenderer.on(IPC.suggestions.onPruned, handler);
      return () => ipcRenderer.off(IPC.suggestions.onPruned, handler);
    }
  },
  agents: {
    list: () => ipcRenderer.invoke(IPC.agents.list),
    messages: (projectId) => ipcRenderer.invoke(IPC.agents.messages, projectId),
    onRegistryChanged: (cb) => {
      const handler = () => cb();
      ipcRenderer.on(IPC.agents.onRegistryChanged, handler);
      return () => ipcRenderer.off(IPC.agents.onRegistryChanged, handler);
    },
    onMessage: (cb) => {
      const handler = (_e: unknown, msg: AgentMessage) => cb(msg);
      ipcRenderer.on(IPC.agents.onMessage, handler);
      return () => ipcRenderer.off(IPC.agents.onMessage, handler);
    },
    onMessagesPruned: (cb) => {
      const handler = (_e: unknown, removedIds: string[]) => cb(removedIds);
      ipcRenderer.on(IPC.agents.onMessagesPruned, handler);
      return () => ipcRenderer.off(IPC.agents.onMessagesPruned, handler);
    }
  },
  saved: {
    save: (input) => ipcRenderer.invoke(IPC.saved.save, input),
    list: () => ipcRenderer.invoke(IPC.saved.list),
    delete: (id) => ipcRenderer.invoke(IPC.saved.delete, id),
    onChanged: (cb) => {
      const handler = (_e: unknown, records: SavedRecord[]) => cb(records);
      ipcRenderer.on(IPC.saved.onChanged, handler);
      return () => ipcRenderer.off(IPC.saved.onChanged, handler);
    }
  },
  personas: {
    list: () => ipcRenderer.invoke(IPC.personas.list),
    revealDir: () => ipcRenderer.invoke(IPC.personas.revealDir),
    save: (input) => ipcRenderer.invoke(IPC.personas.save, input),
    duplicate: (id) => ipcRenderer.invoke(IPC.personas.duplicate, id),
    delete: (id) => ipcRenderer.invoke(IPC.personas.delete, id),
    onChanged: (cb) => {
      const handler = (_e: unknown, personas: Persona[]) => cb(personas);
      ipcRenderer.on(IPC.personas.onChanged, handler);
      return () => ipcRenderer.off(IPC.personas.onChanged, handler);
    }
  },
  teams: {
    list: () => ipcRenderer.invoke(IPC.teams.list),
    revealDir: () => ipcRenderer.invoke(IPC.teams.revealDir),
    save: (input) => ipcRenderer.invoke(IPC.teams.save, input),
    duplicate: (id) => ipcRenderer.invoke(IPC.teams.duplicate, id),
    delete: (id) => ipcRenderer.invoke(IPC.teams.delete, id),
    launch: (teamId, projectId) => ipcRenderer.invoke(IPC.teams.launch, teamId, projectId),
    cancel: (launchRequestId) => ipcRenderer.invoke(IPC.teams.cancel, launchRequestId),
    launchAutonomous: (teamId, projectId, goal) =>
      ipcRenderer.invoke(IPC.teams.launchAutonomous, teamId, projectId, goal),
    stopAutonomous: (runId) => ipcRenderer.invoke(IPC.teams.stopAutonomous, runId),
    exportBundle: (teamId) => ipcRenderer.invoke(IPC.teams.exportBundle, teamId),
    importBundle: () => ipcRenderer.invoke(IPC.teams.importBundle),
    onChanged: (cb) => {
      const handler = (_e: unknown, teams: Team[]) => cb(teams);
      ipcRenderer.on(IPC.teams.onChanged, handler);
      return () => ipcRenderer.off(IPC.teams.onChanged, handler);
    }
  },
  autonomousRuns: {
    list: () => ipcRenderer.invoke(IPC.autonomousRuns.list),
    onChanged: (cb) => {
      const handler = (_e: unknown, runs: AutonomousRun[]) => cb(runs);
      ipcRenderer.on(IPC.autonomousRuns.onChanged, handler);
      return () => ipcRenderer.off(IPC.autonomousRuns.onChanged, handler);
    }
  },
  quickPrompts: {
    list: () => ipcRenderer.invoke(IPC.quickPrompts.list),
    save: (entry) => ipcRenderer.invoke(IPC.quickPrompts.save, entry),
    delete: (id) => ipcRenderer.invoke(IPC.quickPrompts.delete, id),
    revealDir: () => ipcRenderer.invoke(IPC.quickPrompts.revealDir),
    onChanged: (cb) => {
      const handler = (_e: unknown, prompts: QuickPrompt[]) => cb(prompts);
      ipcRenderer.on(IPC.quickPrompts.onChanged, handler);
      return () => ipcRenderer.off(IPC.quickPrompts.onChanged, handler);
    }
  },
  llmPrompts: {
    list: () => ipcRenderer.invoke(IPC.llmPrompts.list),
    save: (entry) => ipcRenderer.invoke(IPC.llmPrompts.save, entry),
    delete: (id) => ipcRenderer.invoke(IPC.llmPrompts.delete, id),
    test: (id, vars) => ipcRenderer.invoke(IPC.llmPrompts.test, id, vars),
    revealDir: () => ipcRenderer.invoke(IPC.llmPrompts.revealDir),
    availableProviders: () => ipcRenderer.invoke(IPC.llmPrompts.availableProviders),
    onChanged: (cb) => {
      const handler = (_e: unknown, prompts: LlmPromptEntry[]) => cb(prompts);
      ipcRenderer.on(IPC.llmPrompts.onChanged, handler);
      return () => ipcRenderer.off(IPC.llmPrompts.onChanged, handler);
    }
  },
  voice: {
    transcribe: (audio, mimeType) => ipcRenderer.invoke(IPC.voice.transcribe, audio, mimeType),
    hasApiKey: () => ipcRenderer.invoke(IPC.voice.hasApiKey),
    ensureMicAccess: () => ipcRenderer.invoke(IPC.voice.ensureMicAccess)
  },
  library: {
    list: () => ipcRenderer.invoke(IPC.library.list),
    add: (input) => ipcRenderer.invoke(IPC.library.add, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.library.update, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC.library.remove, id),
    reveal: (scope, projectId) => ipcRenderer.invoke(IPC.library.reveal, scope, projectId),
    search: (query) => ipcRenderer.invoke(IPC.library.search, query),
    read: (scope, relPath, projectId) => ipcRenderer.invoke(IPC.library.read, scope, relPath, projectId),
    write: (scope, relPath, content, projectId) =>
      ipcRenderer.invoke(IPC.library.write, scope, relPath, content, projectId),
    createFolder: (scope, relPath, projectId) =>
      ipcRenderer.invoke(IPC.library.createFolder, scope, relPath, projectId),
    move: (from, to) => ipcRenderer.invoke(IPC.library.move, from, to),
    deleteEntry: (scope, relPath, projectId) =>
      ipcRenderer.invoke(IPC.library.deleteEntry, scope, relPath, projectId),
    onChanged: (cb) => {
      const handler = (_e: unknown, docs: LibraryDoc[]) => cb(docs);
      ipcRenderer.on(IPC.library.onChanged, handler);
      return () => ipcRenderer.off(IPC.library.onChanged, handler);
    }
  },
  mcp: {
    list: (projectPath) => ipcRenderer.invoke(IPC.mcp.list, projectPath),
    setEnabled: (projectPath, name, enabled) =>
      ipcRenderer.invoke(IPC.mcp.setEnabled, projectPath, name, enabled),
    listAll: () => ipcRenderer.invoke(IPC.mcp.listAll),
    setEnabledById: (id, enabled) =>
      ipcRenderer.invoke(IPC.mcp.setEnabledById, id, enabled),
    reveal: (id) => ipcRenderer.invoke(IPC.mcp.reveal, id),
    onChanged: (cb) => {
      const handler = (_e: unknown, entries: McpServerEntry[]) => cb(entries);
      ipcRenderer.on(IPC.mcp.onChanged, handler);
      return () => ipcRenderer.off(IPC.mcp.onChanged, handler);
    }
  },
  plugins: {
    list: () => ipcRenderer.invoke(IPC.plugins.list),
    setEnabled: (id, enabled) => ipcRenderer.invoke(IPC.plugins.setEnabled, id, enabled),
    reveal: (id) => ipcRenderer.invoke(IPC.plugins.reveal, id),
    onChanged: (cb) => {
      const handler = (_e: unknown, entries: PluginEntry[]) => cb(entries);
      ipcRenderer.on(IPC.plugins.onChanged, handler);
      return () => ipcRenderer.off(IPC.plugins.onChanged, handler);
    }
  },
  pluginApps: {
    list: () => ipcRenderer.invoke(IPC.pluginApps.list),
    onChanged: (cb) => {
      const handler = (_e: unknown, entries: PluginAppEntry[]) => cb(entries);
      ipcRenderer.on(IPC.pluginApps.onChanged, handler);
      return () => ipcRenderer.off(IPC.pluginApps.onChanged, handler);
    }
  },
  extensions: {
    list: () => ipcRenderer.invoke(IPC.extensions.list),
    setEnabled: (id, enabled) => ipcRenderer.invoke(IPC.extensions.setEnabled, id, enabled),
    reveal: (id) => ipcRenderer.invoke(IPC.extensions.reveal, id),
    readRendererEntry: (id) => ipcRenderer.invoke(IPC.extensions.readRendererEntry, id),
    grantConsent: (id) => ipcRenderer.invoke(IPC.extensions.grantConsent, id),
    addPermission: (id, permission) =>
      ipcRenderer.invoke(IPC.extensions.addPermission, id, permission),
    removePermission: (id, permission) =>
      ipcRenderer.invoke(IPC.extensions.removePermission, id, permission),
    relaunch: (id) => ipcRenderer.invoke(IPC.extensions.relaunch, id),
    rescan: () => ipcRenderer.invoke(IPC.extensions.rescan),
    install: (source) => ipcRenderer.invoke(IPC.extensions.install, source),
    uninstall: (id) => ipcRenderer.invoke(IPC.extensions.uninstall, id),
    checkUpdates: () => ipcRenderer.invoke(IPC.extensions.checkUpdates),
    marketplaceList: () => ipcRenderer.invoke(IPC.extensions.marketplaceList),
    createLocal: (req) => ipcRenderer.invoke(IPC.extensions.createLocal, req),
    adoptLocal: () => ipcRenderer.invoke(IPC.extensions.adoptLocal),
    adoptLocalGit: (req) => ipcRenderer.invoke(IPC.extensions.adoptLocalGit, req),
    reinstallLocal: (id) => ipcRenderer.invoke(IPC.extensions.reinstallLocal, id),
    reinstallFromGit: (id) => ipcRenderer.invoke(IPC.extensions.reinstallFromGit, id),
    localInfo: (id) => ipcRenderer.invoke(IPC.extensions.localInfo, id),
    prepareShare: (id) => ipcRenderer.invoke(IPC.extensions.prepareShare, id),
    redeployCapabilities: () => ipcRenderer.invoke(IPC.extensions.redeployCapabilities),
    onInstallProgress: (cb) => {
      const handler = (_e: unknown, line: string) => cb(line);
      ipcRenderer.on(IPC.extensions.installProgress, handler);
      return () => ipcRenderer.off(IPC.extensions.installProgress, handler);
    },
    onChanged: (cb) => {
      const handler = (_e: unknown, entries: ExtensionEntry[]) => cb(entries);
      ipcRenderer.on(IPC.extensions.onChanged, handler);
      return () => ipcRenderer.off(IPC.extensions.onChanged, handler);
    }
  },
  claudeSettings: {
    read: (projectId, scope) => ipcRenderer.invoke(IPC.claudeSettings.read, projectId, scope),
    write: (projectId, scope, patch, expectedHash) =>
      ipcRenderer.invoke(IPC.claudeSettings.write, projectId, scope, patch, expectedHash),
    openFile: (projectId, fileId) => ipcRenderer.invoke(IPC.claudeSettings.openFile, projectId, fileId)
  },
  codexSettings: {
    read: (projectId) => ipcRenderer.invoke(IPC.codexSettings.read, projectId),
    write: (projectId, patch, expectedHash) => ipcRenderer.invoke(IPC.codexSettings.write, projectId, patch, expectedHash)
  },
  openCodeSettings: {
    read: (projectId) => ipcRenderer.invoke(IPC.openCodeSettings.read, projectId),
    write: (projectId, patch, expectedHash) => ipcRenderer.invoke(IPC.openCodeSettings.write, projectId, patch, expectedHash)
  },
  authorizations: {
    apply: (input) => ipcRenderer.invoke(IPC.authorizations.apply, input)
  },
  skills: {
    list: (projectPath?: string) => ipcRenderer.invoke(IPC.skills.list, projectPath),
    setEnabled: (name: string, enabled: boolean) =>
      ipcRenderer.invoke(IPC.skills.setEnabled, name, enabled),
    setManyEnabled: (updates) => ipcRenderer.invoke(IPC.skills.setManyEnabled, updates),
    readHooks: () => ipcRenderer.invoke(IPC.skills.readHooks),
    reveal: (skillId: string, projectPath?: string) =>
      ipcRenderer.invoke(IPC.skills.reveal, skillId, projectPath),
    onChanged: (cb) => {
      const handler = () => cb();
      ipcRenderer.on(IPC.skills.onChanged, handler);
      return () => ipcRenderer.off(IPC.skills.onChanged, handler);
    },
    bundles: {
      list: () => ipcRenderer.invoke(IPC.skills.bundles.list),
      create: (input) => ipcRenderer.invoke(IPC.skills.bundles.create, input),
      update: (id, patch) => ipcRenderer.invoke(IPC.skills.bundles.update, id, patch),
      delete: (id) => ipcRenderer.invoke(IPC.skills.bundles.delete, id),
      apply: (id, mode, projectPath) =>
        ipcRenderer.invoke(IPC.skills.bundles.apply, id, mode, projectPath),
      onChanged: (cb) => {
        const handler = (_e: unknown, bundles: Parameters<typeof cb>[0]) => cb(bundles);
        ipcRenderer.on(IPC.skills.bundles.onChanged, handler);
        return () => ipcRenderer.off(IPC.skills.bundles.onChanged, handler);
      }
    }
  },
  commands: {
    list: (projectPath?: string) => ipcRenderer.invoke(IPC.commands.list, projectPath)
  },
  scheduler: {
    list: () => ipcRenderer.invoke(IPC.scheduler.list),
    create: (input) => ipcRenderer.invoke(IPC.scheduler.create, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.scheduler.update, id, patch),
    delete: (id) => ipcRenderer.invoke(IPC.scheduler.delete, id),
    setEnabled: (id, enabled) =>
      ipcRenderer.invoke(IPC.scheduler.setEnabled, id, enabled),
    runNow: (id) => ipcRenderer.invoke(IPC.scheduler.runNow, id),
    onChanged: (cb) => {
      const handler = (_e: unknown, tasks: Parameters<typeof cb>[0]) => cb(tasks);
      ipcRenderer.on(IPC.scheduler.onChanged, handler);
      return () => ipcRenderer.off(IPC.scheduler.onChanged, handler);
    },
    listTemplates: () => ipcRenderer.invoke(IPC.scheduler.listTemplates),
    onTemplatesChanged: (cb) => {
      const handler = (_e: unknown, templates: Parameters<typeof cb>[0]) => cb(templates);
      ipcRenderer.on(IPC.scheduler.onTemplatesChanged, handler);
      return () => ipcRenderer.off(IPC.scheduler.onTemplatesChanged, handler);
    },
    revealTemplatesDir: () => ipcRenderer.invoke(IPC.scheduler.revealTemplatesDir),
    groups: {
      list: () => ipcRenderer.invoke(IPC.scheduler.groupsList),
      create: (input) => ipcRenderer.invoke(IPC.scheduler.groupsCreate, input),
      update: (id, patch) => ipcRenderer.invoke(IPC.scheduler.groupsUpdate, id, patch),
      delete: (id) => ipcRenderer.invoke(IPC.scheduler.groupsDelete, id),
      reorder: (orderedIds) => ipcRenderer.invoke(IPC.scheduler.groupsReorder, orderedIds),
      onChanged: (cb) => {
        const handler = (_e: unknown, groups: Parameters<typeof cb>[0]) => cb(groups);
        ipcRenderer.on(IPC.scheduler.groupsOnChanged, handler);
        return () => ipcRenderer.off(IPC.scheduler.groupsOnChanged, handler);
      }
    }
  },
  goals: {
    list: () => ipcRenderer.invoke(IPC.goals.list),
    create: (input) => ipcRenderer.invoke(IPC.goals.create, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.goals.update, id, patch),
    delete: (id) => ipcRenderer.invoke(IPC.goals.delete, id),
    setStatus: (id, status) => ipcRenderer.invoke(IPC.goals.setStatus, id, status),
    runNow: (id) => ipcRenderer.invoke(IPC.goals.runNow, id),
    onChanged: (cb) => {
      const handler = (_e: unknown, goals: Parameters<typeof cb>[0]) => cb(goals);
      ipcRenderer.on(IPC.goals.onChanged, handler);
      return () => ipcRenderer.off(IPC.goals.onChanged, handler);
    }
  },
  followups: {
    list: () => ipcRenderer.invoke(IPC.followups.list),
    create: (input) => ipcRenderer.invoke(IPC.followups.create, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.followups.update, id, patch),
    delete: (id) => ipcRenderer.invoke(IPC.followups.delete, id),
    setStatus: (id, status, resolution) =>
      ipcRenderer.invoke(IPC.followups.setStatus, id, status, resolution),
    markSpawned: (id) => ipcRenderer.invoke(IPC.followups.markSpawned, id),
    onChanged: (cb) => {
      const handler = (_e: unknown, followups: Parameters<typeof cb>[0]) => cb(followups);
      ipcRenderer.on(IPC.followups.onChanged, handler);
      return () => ipcRenderer.off(IPC.followups.onChanged, handler);
    }
  },
  feed: {
    list: (projectId, opts) => ipcRenderer.invoke(IPC.feed.list, projectId, opts),
    refresh: (projectId, opts) => ipcRenderer.invoke(IPC.feed.refresh, projectId, opts),
    digest: (projectId) => ipcRenderer.invoke(IPC.feed.digest, projectId),
    onChanged: (cb) => {
      const handler = (_e: unknown, projectId: Parameters<typeof cb>[0]) => cb(projectId);
      ipcRenderer.on(IPC.feed.onChanged, handler);
      return () => ipcRenderer.off(IPC.feed.onChanged, handler);
    }
  },
  modules: {
    call: (moduleId, capability, args) =>
      ipcRenderer.invoke(IPC.modules.call, moduleId, capability, args),
    storageGet: (moduleId, key) => ipcRenderer.invoke(IPC.modules.storageGet, moduleId, key),
    storageSet: (moduleId, key, value) =>
      ipcRenderer.invoke(IPC.modules.storageSet, moduleId, key, value),
    pushInbox: (moduleId, msg) => ipcRenderer.invoke(IPC.modules.pushInbox, moduleId, msg),
    // ctx.stream push direction (wiring (a)): core relays each live frame /
    // terminal signal here keyed by the opaque subId. The renderer host fans
    // these out to per-subId subscribers; each returns an unsubscribe fn.
    onStreamFrame: (cb: (subId: string, frame: unknown) => void) => {
      const handler = (_e: unknown, subId: string, frame: unknown) => cb(subId, frame);
      ipcRenderer.on(IPC.modules.streamFrame, handler);
      return () => ipcRenderer.off(IPC.modules.streamFrame, handler);
    },
    onStreamDone: (cb: (subId: string, reason: { ok: boolean; error?: string }) => void) => {
      const handler = (_e: unknown, subId: string, reason: { ok: boolean; error?: string }) =>
        cb(subId, reason);
      ipcRenderer.on(IPC.modules.streamDone, handler);
      return () => ipcRenderer.off(IPC.modules.streamDone, handler);
    },
    // W1-4 trust inversion: core pushes a host command (toast/navigate/select/
    // launch) core→renderer, keyed by the authenticated moduleId. Returns an
    // unsubscribe fn, same shape as onStreamFrame.
    onHostCommand: (
      cb: (cmd: { moduleId: string; kind: string; payload: unknown }) => void
    ) => {
      const handler = (
        _e: unknown,
        cmd: { moduleId: string; kind: string; payload: unknown }
      ) => cb(cmd);
      ipcRenderer.on(IPC.modules.hostCommand, handler);
      return () => ipcRenderer.off(IPC.modules.hostCommand, handler);
    },
    // W1-4 durable park: pull + CLEAR every parked launch from main (on mount +
    // on each launchParked nudge) so a launch requested while no panel was
    // listening is delivered on the next attach, never dropped.
    drainParkedLaunches: () => ipcRenderer.invoke(IPC.modules.drainParkedLaunches),
    // W1-5 main-reachable host UX: reply the human's confirm/notify answer back
    // to main, keyed by the dialog's requestId, so the relay resolves the main
    // module's pending Promise. Fire-and-forget (the answer already updated the
    // renderer's own state); a late/unknown id is a no-op main-side.
    replyHostDialog: (requestId: string, answer: unknown) =>
      ipcRenderer.invoke(IPC.modules.replyHostDialog, requestId, answer)
  },
  app: {
    onMenuEvent: (cb: (event: string) => void) => {
      const events = [
        'app:openSettings',
        'app:newClaudeTab',
        'app:reopenTab',
        'app:closeTab',
        'app:toggleWorkspaceMode',
        'app:openPalette',
        'app:openShortcuts'
      ];
      const handlers = events.map((name) => {
        const h = () => cb(name);
        ipcRenderer.on(name, h);
        return { name, h };
      });
      return () => {
        for (const { name, h } of handlers) ipcRenderer.off(name, h);
      };
    },
    homedir: () => ipcRenderer.invoke(IPC.app.homedir),
    version: () => ipcRenderer.invoke(IPC.app.version),
    microVmSupported: () => ipcRenderer.invoke(IPC.app.microVmSupported),
    onFocusSession: (cb: (sessionId: string, projectId: string) => void) => {
      const handler = (_e: unknown, sessionId: string, projectId: string) =>
        cb(sessionId, projectId);
      ipcRenderer.on('app:focusSession', handler);
      return () => ipcRenderer.off('app:focusSession', handler);
    },
    onOpenScheduler: (cb: (taskId?: string) => void) => {
      const handler = (_e: unknown, taskId?: string) => cb(taskId);
      ipcRenderer.on('app:openScheduler', handler);
      return () => ipcRenderer.off('app:openScheduler', handler);
    },
    onOpenAgents: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('app:openAgents', handler);
      return () => ipcRenderer.off('app:openAgents', handler);
    },
    onFavoritesChanged: (cb: (keys: string[]) => void) => {
      const handler = (_e: unknown, keys: string[]) => cb(keys);
      ipcRenderer.on('app:favoritesChanged', handler);
      return () => ipcRenderer.off('app:favoritesChanged', handler);
    },
    onFocusInboxEntry: (cb: (entryId: string, projectId: string) => void) => {
      const handler = (_e: unknown, entryId: string, projectId: string) => cb(entryId, projectId);
      ipcRenderer.on('app:focusInboxEntry', handler);
      return () => ipcRenderer.off('app:focusInboxEntry', handler);
    },
    setFullScreen: (flag: boolean) => ipcRenderer.invoke(IPC.app.setFullScreen, flag),
    isFullScreen: () => ipcRenderer.invoke(IPC.app.isFullScreen),
    onFullScreenChanged: (cb: (isFullScreen: boolean) => void) => {
      const handler = (_e: unknown, isFullScreen: boolean) => cb(isFullScreen);
      ipcRenderer.on(IPC.app.onFullScreenChanged, handler);
      return () => ipcRenderer.off(IPC.app.onFullScreenChanged, handler);
    }
  },
  menubar: {
    request: () => ipcRenderer.invoke(IPC.menubar.request),
    onSnapshot: (cb: (snapshot: MenubarSnapshot) => void) => {
      const handler = (_e: unknown, snapshot: MenubarSnapshot) => cb(snapshot);
      ipcRenderer.on(IPC.menubar.onSnapshot, handler);
      return () => ipcRenderer.off(IPC.menubar.onSnapshot, handler);
    },
    focusSession: (sessionId: string, projectId: string) =>
      ipcRenderer.invoke(IPC.menubar.focusSession, sessionId, projectId),
    setFavorite: (sessionId: string, favorite: boolean) =>
      ipcRenderer.invoke(IPC.menubar.setFavorite, sessionId, favorite),
    reply: (sessionId: string, text: string) =>
      ipcRenderer.invoke(IPC.menubar.reply, sessionId, text),
    open: (view: 'dashboard' | 'agents' | 'settings' | 'scheduler') =>
      ipcRenderer.invoke(IPC.menubar.open, view),
    hide: () => ipcRenderer.invoke(IPC.menubar.hide),
    quit: () => ipcRenderer.invoke(IPC.menubar.quit)
  },
  windows: {
    openProject: (projectId: string) =>
      ipcRenderer.invoke(IPC.windows.openProject, projectId)
  },
  updates: {
    check: () => ipcRenderer.invoke(IPC.updates.check),
    download: (opts?: { installNow?: boolean }) => ipcRenderer.invoke(IPC.updates.download, opts),
    skip: (version: string) => ipcRenderer.invoke(IPC.updates.skip, version),
    quitAndInstall: () => ipcRenderer.invoke(IPC.updates.quitAndInstall),
    simulate: (version: string) => ipcRenderer.invoke(IPC.updates.simulate, version),
    getStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.updates.getStatus),
    onStatus: (cb: (status: UpdateStatus) => void) => {
      const handler = (_e: unknown, status: UpdateStatus) => cb(status);
      ipcRenderer.on(IPC.updates.onStatus, handler);
      return () => ipcRenderer.off(IPC.updates.onStatus, handler);
    },
    onProgress: (cb: (progress: UpdateProgress) => void) => {
      const handler = (_e: unknown, progress: UpdateProgress) => cb(progress);
      ipcRenderer.on(IPC.updates.onProgress, handler);
      return () => ipcRenderer.off(IPC.updates.onProgress, handler);
    },
    getReleaseNotes: (range?: {
      fromVersion?: string | null;
      toVersion?: string | null;
    }): Promise<ReleaseNote[]> => ipcRenderer.invoke(IPC.updates.getReleaseNotes, range),
    consumeWhatsNew: (): Promise<WhatsNewEvent | null> =>
      ipcRenderer.invoke(IPC.updates.consumeWhatsNew)
  },
  deps: {
    get: () => ipcRenderer.invoke(IPC.deps.get),
    check: () => ipcRenderer.invoke(IPC.deps.check),
    install: () => ipcRenderer.invoke(IPC.deps.install),
    dismiss: () => ipcRenderer.invoke(IPC.deps.dismiss),
    onStatus: (cb: (status: SetupStatus) => void) => {
      const handler = (_e: unknown, status: SetupStatus) => cb(status);
      ipcRenderer.on(IPC.deps.onStatus, handler);
      return () => ipcRenderer.off(IPC.deps.onStatus, handler);
    },
    onProgress: (cb: (progress: DependencyProgress) => void) => {
      const handler = (_e: unknown, progress: DependencyProgress) => cb(progress);
      ipcRenderer.on(IPC.deps.onProgress, handler);
      return () => ipcRenderer.off(IPC.deps.onProgress, handler);
    }
  }
};

contextBridge.exposeInMainWorld('cc', api);
// OS chrome that remains after product I/O moves to loopback HTTP. The full
// `cc` bridge is still exposed during the migration so existing desktop
// families keep working; new product APIs should land on HTTP first.
contextBridge.exposeInMainWorld('zccDesktop', {
  app: api.app,
  windows: api.windows,
  updates: api.updates,
  menubar: api.menubar
});

// E2E test-observability bridge (GATED). Exposed ONLY when main launched this
// window with `--zcc-e2e` (see createWindow additionalArguments) — the sandboxed
// preload reads argv, not env. In production the branch is dead and
// `window.__zccTest` is undefined, so there is no test surface. Backed by the
// gated `test:*` IPC handlers → the ring buffer in src/main/test-tap.ts.
if (process.argv.includes('--zcc-e2e')) {
  contextBridge.exposeInMainWorld('__zccTest', {
    drainEvents: (cursor: number) => ipcRenderer.invoke(IPC.test.drainEvents, cursor),
    snapshot: () => ipcRenderer.invoke(IPC.test.snapshot),
    reset: () => ipcRenderer.invoke(IPC.test.reset)
  });
}
