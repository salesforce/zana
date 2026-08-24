import { homedir } from 'node:os';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { isWithin, resolveContainedReal } from '@zana-ai/zcc-path-confine';
import type {
  HostDirEntry,
  HostEventEnvelope,
  HostListedFile,
  HostRpcCommand,
  ProviderListModelsResult,
  ProviderStatusResult,
  ThreadResumeFields,
  ThreadStartCommandSchema
} from '@zana-ai/zcc-contracts/host-rpc';
import type { z } from 'zod';
import { harnessFamilyOf, parseProfile } from '@zana-ai/zcc-domain/launch-provider';
import type { AppConfig, HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
import {
  WorkspaceError,
  cloneProject,
  destroyWorkspace,
  provisionWorkspace,
  resolveCloneDefaultPath,
  workspaceBranches,
  workspaceCommit,
  workspaceDiff,
  workspaceDiffFiles,
  workspaceDiffPatch,
  workspacePullRequest,
  workspacePullRequestAction,
  workspacePullRequestCreate,
  workspaceSquashMerge,
  workspaceStatus
} from '@zana-ai/zcc-host-workspace';
import { verifyHarnesses } from './harness/harness-verify.js';
import { HostCommandError } from './host-command-error.js';
import { transcribeCodexVoice } from './codex-voice-transcribe.js';

const MAX_LISTED_FILES = 500;
const MAX_DIR_ENTRIES = 2000;
const MAX_READ_BYTES = 1_000_000;
const LIST_DIR_DENY = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.DS_Store'
]);

export type ThreadStartFields = z.infer<typeof ThreadStartCommandSchema>;

export type ThreadWorkInput = Omit<ThreadStartFields, 'type' | 'cwd'> & {
  cwd: string;
};

export type ThreadResumeInput = {
  threadId: string;
  environmentId: string;
  projectId: string;
  providerId: string;
  providerThreadId: string;
  cwd: string;
  bridgeLaunch?: ThreadStartFields['bridgeLaunch'];
  permissionMode?: ThreadStartFields['permissionMode'];
  model?: string;
  reasoningLevel?: ThreadWorkInput['reasoningLevel'];
};

export interface CommandRuntime {
  dataDir: string;
  environments: Map<string, { path: string; workspaceProvisionType: 'unmanaged' | 'managed-worktree' | 'personal' }>;
  threads: Map<string, { environmentId: string; providerId: string }>;
  terminals: Map<string, { cwd: string }>;
  provisionSignals: Map<string, AbortController>;
  lanes: Map<string, Promise<void>>;
  verifyProviders: () => Promise<ProviderStatusResult>;
  emit: (event: HostEventEnvelope) => void;
  startWork?: (input: ThreadWorkInput) => Promise<{ providerThreadId?: string } | void>;
  submitTurn?: (input: {
    threadId: string;
    input: string[];
    mode?: string;
    model?: string;
    reasoningLevel?: ThreadWorkInput['reasoningLevel'];
  }) => Promise<void>;
  resumeWork?: (input: ThreadResumeInput) => Promise<{ providerThreadId?: string } | void>;
  resizeWork?: (input: { threadId: string; cols: number; rows: number }) => Promise<void>;
  writeWork?: (input: { threadId: string; data: string }) => Promise<void>;
  stopWork?: (input: { threadId: string }) => Promise<void>;
  startTerminal?: (input: { sessionId: string; cwd: string; cols: number; rows: number }) => Promise<{ pid?: number } | void>;
  writeTerminal?: (input: { sessionId: string; data: string }) => Promise<void>;
  resizeTerminal?: (input: { sessionId: string; cols: number; rows: number }) => Promise<void>;
  stopTerminal?: (input: { sessionId: string }) => Promise<void>;
  listModels?: (input: {
    providerId: string;
    bridgeLaunch: NonNullable<ThreadWorkInput['bridgeLaunch']>;
    cwd?: string;
  }) => Promise<ProviderListModelsResult>;
}

export function createCommandRuntime(options: {
  dataDir?: string;
  loadConfig?: () => AppConfig;
  verifyProviders?: () => Promise<ProviderStatusResult>;
  emit?: (event: HostEventEnvelope) => void;
  startWork?: (input: ThreadWorkInput) => Promise<{ providerThreadId?: string } | void>;
  submitTurn?: (input: {
    threadId: string;
    input: string[];
    mode?: string;
    model?: string;
    reasoningLevel?: ThreadWorkInput['reasoningLevel'];
  }) => Promise<void>;
  resumeWork?: (input: ThreadResumeInput) => Promise<{ providerThreadId?: string } | void>;
  resizeWork?: (input: { threadId: string; cols: number; rows: number }) => Promise<void>;
  writeWork?: (input: { threadId: string; data: string }) => Promise<void>;
  stopWork?: (input: { threadId: string }) => Promise<void>;
  startTerminal?: (input: { sessionId: string; cwd: string; cols: number; rows: number }) => Promise<{ pid?: number } | void>;
  writeTerminal?: (input: { sessionId: string; data: string }) => Promise<void>;
  resizeTerminal?: (input: { sessionId: string; cols: number; rows: number }) => Promise<void>;
  stopTerminal?: (input: { sessionId: string }) => Promise<void>;
  listModels?: (input: {
    providerId: string;
    bridgeLaunch: NonNullable<ThreadWorkInput['bridgeLaunch']>;
    cwd?: string;
  }) => Promise<ProviderListModelsResult>;
}): CommandRuntime {
  const loadConfig = options.loadConfig ?? (() => ({ version: 1, theme: 'dark', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13, lastProjectId: null }) as AppConfig);
  return {
    dataDir: options.dataDir ?? join(homedir(), '.zcc'),
    environments: new Map(),
    threads: new Map(),
    terminals: new Map(),
    provisionSignals: new Map(),
    lanes: new Map(),
    emit: options.emit ?? (() => {}),
    startWork: options.startWork,
    submitTurn: options.submitTurn,
    resumeWork: options.resumeWork,
    resizeWork: options.resizeWork,
    writeWork: options.writeWork,
    stopWork: options.stopWork,
    startTerminal: options.startTerminal,
    writeTerminal: options.writeTerminal,
    resizeTerminal: options.resizeTerminal,
    stopTerminal: options.stopTerminal,
    listModels: options.listModels,
    verifyProviders: options.verifyProviders ?? (async () => {
      const results: HarnessVerifyResult[] = await verifyHarnesses(loadConfig());
      return { providers: results };
    })
  };
}

async function withEnvironmentLane<T>(runtime: CommandRuntime, environmentId: string, run: () => Promise<T>): Promise<T> {
  const previous = runtime.lanes.get(environmentId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  runtime.lanes.set(environmentId, previous.then(() => current));
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (runtime.lanes.get(environmentId) === current) runtime.lanes.delete(environmentId);
  }
}

function mapWorkspaceError(error: unknown): never {
  if (error instanceof WorkspaceError) {
    throw new HostCommandError(error.code, error.message);
  }
  if (error instanceof HostCommandError) throw error;
  throw new HostCommandError('internal', error instanceof Error ? error.message : String(error));
}

function providerFamily(providerId: string): string | null {
  const profile = parseProfile(providerId);
  if (!profile) return null;
  if (profile === 'shell') return 'shell';
  return harnessFamilyOf(profile);
}

function providerAvailable(status: ProviderStatusResult, providerId: string): boolean {
  const family = providerFamily(providerId);
  if (!family) return false;
  if (family === 'shell') return true;
  const provider = status.providers.find((entry) => entry.family === family);
  return Boolean(provider?.installed && provider.enabled);
}

function confineThreadCwd(environmentPath: string, requested?: string): string {
  if (!requested) return environmentPath;
  let realEnv: string;
  let realRequested: string;
  try {
    realEnv = realpathSync(environmentPath);
    realRequested = realpathSync(requested);
  } catch {
    throw new HostCommandError('cwd-escape', 'cwd is outside the environment');
  }
  if (!isWithin(realRequested, realEnv)) {
    throw new HostCommandError('cwd-escape', 'cwd is outside the environment');
  }
  return realRequested;
}

async function applyThreadResume(
  runtime: CommandRuntime,
  command: {
    threadId: string;
    environmentId: string;
  } & ThreadResumeFields
): Promise<{ threadId: string; resumed: true; providerThreadId?: string }> {
  const environment = runtime.environments.get(command.environmentId);
  const environmentPath = environment?.path ?? command.cwd;
  if (!environmentPath) {
    throw new HostCommandError('environment_not_ready', 'environment is not provisioned');
  }
  const cwd = confineThreadCwd(environmentPath, command.cwd);
  let providerThreadId = command.providerThreadId;
  if (runtime.resumeWork) {
    const resumed = await runtime.resumeWork({
      threadId: command.threadId,
      environmentId: command.environmentId,
      projectId: command.projectId,
      providerId: command.providerId,
      providerThreadId: command.providerThreadId,
      cwd,
      bridgeLaunch: command.bridgeLaunch,
      permissionMode: command.permissionMode,
      model: command.model,
      reasoningLevel: command.reasoningLevel
    });
    providerThreadId = resumed?.providerThreadId ?? providerThreadId;
  }
  runtime.threads.set(command.threadId, {
    environmentId: command.environmentId,
    providerId: command.providerId
  });
  if (!environment) {
    runtime.environments.set(command.environmentId, {
      path: environmentPath,
      workspaceProvisionType: 'unmanaged'
    });
  }
  return {
    threadId: command.threadId,
    resumed: true as const,
    ...(providerThreadId ? { providerThreadId } : {})
  };
}

async function resumeThreadRuntimeIfMissing(
  runtime: CommandRuntime,
  command: Extract<HostRpcCommand, { type: 'turn.submit' }>
): Promise<void> {
  if (runtime.threads.has(command.threadId)) return;
  if (!command.resume?.providerThreadId) {
    throw new HostCommandError('unknown_thread', 'thread is not running on this host');
  }
  await applyThreadResume(runtime, {
    threadId: command.threadId,
    environmentId: command.environmentId,
    ...command.resume
  });
}

function requireTerminal(runtime: CommandRuntime, sessionId: string): { cwd: string } {
  const session = runtime.terminals.get(sessionId);
  if (!session) {
    throw new HostCommandError('unknown_terminal', 'terminal is not running on this host');
  }
  return session;
}

function listRoot(root: string): HostListedFile[] {
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
    if (!statSync(realRoot).isDirectory()) return [];
  } catch {
    return [];
  }
  const files: HostListedFile[] = [];
  const stack = [realRoot];
  while (stack.length > 0 && files.length < MAX_LISTED_FILES) {
    const dir = stack.pop()!;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (files.length >= MAX_LISTED_FILES) break;
      const abs = join(dir, name);
      let real: string;
      let stat;
      try {
        real = realpathSync(abs);
        stat = statSync(real);
      } catch {
        continue;
      }
      if (!isWithin(real, realRoot)) continue;
      const relPath = relative(realRoot, real).split(sep).join('/');
      if (!relPath || relPath === 'index.json') continue;
      files.push({
        root,
        relPath,
        bytes: stat.isFile() ? stat.size : 0,
        kind: stat.isDirectory() ? 'dir' : 'file'
      });
      if (stat.isDirectory()) stack.push(real);
    }
  }
  return files;
}

async function resolveListDirTarget(root: string, relPath: string): Promise<string | null> {
  const trimmed = relPath.trim();
  if (!trimmed || trimmed === '.') {
    try {
      const realRoot = realpathSync(root);
      return statSync(realRoot).isDirectory() ? realRoot : null;
    } catch {
      return null;
    }
  }
  return resolveContainedReal(root, trimmed);
}

function listDirShallow(absDir: string): HostDirEntry[] {
  let dirents;
  try {
    dirents = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: HostDirEntry[] = [];
  for (const entry of dirents) {
    if (LIST_DIR_DENY.has(entry.name)) continue;
    const full = join(absDir, entry.name);
    let kind: 'file' | 'dir';
    if (entry.isSymbolicLink()) {
      try {
        kind = statSync(full).isDirectory() ? 'dir' : 'file';
      } catch {
        continue;
      }
    } else {
      kind = entry.isDirectory() ? 'dir' : 'file';
    }
    out.push({ name: entry.name, kind, path: full });
    if (out.length >= MAX_DIR_ENTRIES) break;
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

export async function dispatchHostCommand(
  runtime: CommandRuntime,
  command: HostRpcCommand
): Promise<unknown> {
  switch (command.type) {
    case 'provider.status':
      return runtime.verifyProviders();
    case 'provider.list_models': {
      if (!runtime.listModels) {
        throw new HostCommandError('unsupported', 'model listing is not available on this host');
      }
      return runtime.listModels({
        providerId: command.providerId,
        bridgeLaunch: command.bridgeLaunch,
        ...(command.cwd !== undefined ? { cwd: command.cwd } : {})
      });
    }
    case 'environment.provision': {
      return withEnvironmentLane(runtime, command.environmentId, async () => {
        try {
          const controller = new AbortController();
          runtime.provisionSignals.set(command.environmentId, controller);
          const onProgress = command.initiator
            ? (entry: { type: string; key: string; text: string }) => {
              runtime.emit({
                threadId: command.initiator!.threadId,
                kind: 'environment.provision.progress',
                payload: entry
              });
            }
            : undefined;
          const provisioned = command.workspaceProvisionType === 'unmanaged'
            ? await provisionWorkspace({
                workspaceProvisionType: 'unmanaged',
                path: command.path,
                checkout: command.checkout,
                onProgress,
                signal: controller.signal
              })
            : command.workspaceProvisionType === 'personal'
              ? await provisionWorkspace({
                  workspaceProvisionType: 'personal',
                  targetPath: command.targetPath,
                  onProgress,
                  signal: controller.signal
                })
              : await provisionWorkspace({
                  workspaceProvisionType: 'managed-worktree',
                  sourcePath: command.sourcePath,
                  targetPath: command.targetPath,
                  branchName: command.branchName,
                  baseBranch: command.baseBranch,
                  setupTimeoutMs: command.setupTimeoutMs,
                  onProgress,
                  signal: controller.signal
                });
          runtime.environments.set(command.environmentId, {
            path: provisioned.discovered.path,
            workspaceProvisionType: command.workspaceProvisionType
          });
          return {
            environmentId: command.environmentId,
            ...provisioned.discovered,
            transcript: provisioned.transcript
          };
        } catch (error) {
          mapWorkspaceError(error);
        } finally {
          runtime.provisionSignals.delete(command.environmentId);
        }
      });
    }
    case 'environment.provision.cancel': {
      runtime.provisionSignals.get(command.environmentId)?.abort();
      return { environmentId: command.environmentId, cancelled: true as const };
    }
    case 'environment.destroy': {
      return withEnvironmentLane(runtime, command.environmentId, async () => {
        try {
          await destroyWorkspace({
            path: command.workspacePath,
            workspaceProvisionType: command.workspaceProvisionType
          });
          runtime.environments.delete(command.environmentId);
          return { environmentId: command.environmentId, destroyed: true as const };
        } catch (error) {
          mapWorkspaceError(error);
        }
      });
    }
    case 'thread.start': {
      const environment = runtime.environments.get(command.environmentId);
      if (!environment) {
        throw new HostCommandError('environment_not_ready', 'environment is not provisioned');
      }
      if (!command.bridgeLaunch && !providerAvailable(await runtime.verifyProviders(), command.providerId)) {
        throw new HostCommandError('provider_unavailable', `provider CLI is not available: ${command.providerId}`);
      }
      const cwd = confineThreadCwd(environment.path, command.cwd);
      let providerThreadId: string | undefined;
      if (runtime.startWork) {
        const { type: _type, cwd: _cwd, ...rest } = command;
        const started = await runtime.startWork({ ...rest, cwd });
        providerThreadId = started?.providerThreadId;
      }
      runtime.threads.set(command.threadId, {
        environmentId: command.environmentId,
        providerId: command.providerId
      });
      runtime.emit({ threadId: command.threadId, kind: 'thread.started' });
      return {
        threadId: command.threadId,
        started: true as const,
        ...(providerThreadId ? { providerThreadId } : {})
      };
    }
    case 'thread.resize': {
      if (!runtime.threads.has(command.threadId)) {
        throw new HostCommandError('unknown_thread', 'thread is not running on this host');
      }
      if (runtime.resizeWork) {
        await runtime.resizeWork({
          threadId: command.threadId,
          cols: command.cols,
          rows: command.rows
        });
      }
      return { threadId: command.threadId, resized: true as const };
    }
    case 'thread.input': {
      if (!runtime.threads.has(command.threadId)) {
        throw new HostCommandError('unknown_thread', 'thread is not running on this host');
      }
      if (runtime.writeWork) {
        await runtime.writeWork({ threadId: command.threadId, data: command.data });
      }
      return { threadId: command.threadId, accepted: true as const };
    }
    case 'thread.stop': {
      if (runtime.stopWork) {
        await runtime.stopWork({ threadId: command.threadId });
      }
      runtime.threads.delete(command.threadId);
      return { threadId: command.threadId, stopped: true as const };
    }
    case 'thread.resume':
      return applyThreadResume(runtime, command);
    case 'turn.submit': {
      await resumeThreadRuntimeIfMissing(runtime, command);
      if (runtime.submitTurn) {
        await runtime.submitTurn({
          threadId: command.threadId,
          input: command.input,
          mode: command.mode,
          model: command.model,
          reasoningLevel: command.reasoningLevel
        });
      } else {
        runtime.emit({ threadId: command.threadId, kind: 'turn.completed' });
      }
      return { threadId: command.threadId, accepted: true as const };
    }
    case 'terminal.start': {
      const cwd = confineThreadCwd(command.root, command.cwd);
      const cols = command.cols ?? 80;
      const rows = command.rows ?? 24;
      let pid: number | undefined;
      if (runtime.startTerminal) {
        const started = await runtime.startTerminal({
          sessionId: command.sessionId,
          cwd,
          cols,
          rows
        });
        pid = started?.pid;
      }
      runtime.terminals.set(command.sessionId, { cwd });
      return {
        sessionId: command.sessionId,
        started: true as const,
        ...(pid !== undefined ? { pid } : {})
      };
    }
    case 'terminal.input': {
      requireTerminal(runtime, command.sessionId);
      if (runtime.writeTerminal) {
        await runtime.writeTerminal({ sessionId: command.sessionId, data: command.data });
      }
      return { sessionId: command.sessionId, accepted: true as const };
    }
    case 'terminal.resize': {
      requireTerminal(runtime, command.sessionId);
      if (runtime.resizeTerminal) {
        await runtime.resizeTerminal({
          sessionId: command.sessionId,
          cols: command.cols,
          rows: command.rows
        });
      }
      return { sessionId: command.sessionId, resized: true as const };
    }
    case 'terminal.stop': {
      requireTerminal(runtime, command.sessionId);
      if (runtime.stopTerminal) {
        await runtime.stopTerminal({ sessionId: command.sessionId });
      }
      runtime.terminals.delete(command.sessionId);
      return { sessionId: command.sessionId, stopped: true as const };
    }
    case 'host.list_files':
      return { files: command.roots.flatMap(listRoot) };
    case 'host.list_dir': {
      const contained = await resolveListDirTarget(command.root, command.relPath);
      if (!contained) {
        throw new HostCommandError('path_not_found', 'path is outside the authorized root');
      }
      let stat;
      try {
        stat = statSync(contained);
      } catch {
        throw new HostCommandError('path_not_found', 'directory not found');
      }
      if (!stat.isDirectory()) {
        throw new HostCommandError('path_not_found', 'not a directory');
      }
      return { entries: listDirShallow(contained) };
    }
    case 'host.read_file': {
      const contained = await resolveContainedReal(command.root, command.relPath);
      if (!contained) {
        throw new HostCommandError('path_not_found', 'path is outside the authorized root');
      }
      let stat;
      try {
        stat = statSync(contained);
      } catch {
        throw new HostCommandError('path_not_found', 'file not found');
      }
      if (!stat.isFile()) throw new HostCommandError('path_not_found', 'not a file');
      if (stat.size > MAX_READ_BYTES) {
        throw new HostCommandError('too_large', 'file exceeds the read cap');
      }
      return { content: readFileSync(contained, 'utf8'), encoding: 'utf8' as const };
    }
    case 'host.list_branches':
      try {
        return await workspaceBranches(command.workspacePath, command.limit);
      } catch (error) {
        mapWorkspaceError(error);
      }
    case 'workspace.status':
      try {
        return await workspaceStatus(command.workspacePath);
      } catch (error) {
        mapWorkspaceError(error);
      }
    case 'workspace.diff':
      try {
        return await workspaceDiff(command.workspacePath, command.target);
      } catch (error) {
        mapWorkspaceError(error);
      }
    case 'workspace.diffFiles':
      try {
        return await workspaceDiffFiles(command.workspacePath, command.target, command.maxFiles ?? 400);
      } catch (error) {
        mapWorkspaceError(error);
      }
    case 'workspace.diffPatch':
      try {
        return await workspaceDiffPatch(
          command.workspacePath,
          command.target,
          command.paths,
          command.maxBytesPerFile ?? 64 * 1024
        );
      } catch (error) {
        mapWorkspaceError(error);
      }
    case 'workspace.commit':
      try {
        return await workspaceCommit(command.workspacePath, command.message, command.noVerify);
      } catch (error) {
        mapWorkspaceError(error);
      }
    case 'workspace.squash_merge':
      try {
        return await workspaceSquashMerge(command.workspacePath, command.targetBranch, command.message);
      } catch (error) {
        mapWorkspaceError(error);
      }
    case 'workspace.pull_request':
      try {
        return { pullRequest: await workspacePullRequest(command.workspacePath) };
      } catch (error) {
        mapWorkspaceError(error);
      }
    case 'workspace.pull_request_ready':
      try {
        return await workspacePullRequestAction(command.workspacePath, { operation: 'ready' });
      } catch (error) {
        mapWorkspaceError(error);
      }
    case 'workspace.pull_request_draft':
      try {
        return await workspacePullRequestAction(command.workspacePath, { operation: 'draft' });
      } catch (error) {
        mapWorkspaceError(error);
      }
    case 'workspace.pull_request_merge':
      try {
        return await workspacePullRequestAction(command.workspacePath, { operation: 'merge', method: command.method });
      } catch (error) {
        mapWorkspaceError(error);
      }
    case 'workspace.pull_request_create':
      try {
        return {
          pullRequest: await workspacePullRequestCreate(command.workspacePath, {
            title: command.title,
            body: command.body,
            base: command.base,
            draft: command.draft
          })
        };
      } catch (error) {
        mapWorkspaceError(error);
      }
    case 'project.clone_default_path':
      return { path: await resolveCloneDefaultPath(runtime.dataDir, command.projectSlug) };
    case 'project.clone':
      try {
        return await cloneProject({
          dataDir: runtime.dataDir,
          projectSlug: command.projectSlug,
          remoteUrl: command.remoteUrl,
          targetPath: command.targetPath,
          onProgress: (text) => {
            runtime.emit({ kind: 'project.clone.progress', payload: { text } });
          }
        });
      } catch (error) {
        mapWorkspaceError(error);
      }
    case 'codex.voice.transcribe':
      return transcribeCodexVoice(command);
    default: {
      const exhaustive: never = command;
      throw new HostCommandError('unknown_command', `unsupported command ${(exhaustive as { type: string }).type}`);
    }
  }
}
