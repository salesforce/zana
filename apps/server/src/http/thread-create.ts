import { projectOnHost, ProjectSourceUnavailableError } from '@zana-ai/zcc-domain/project';
import type {
  EnvironmentProvisionResult,
  ProviderStatusResult,
  ThreadStartResult
} from '@zana-ai/zcc-contracts/host-rpc';
import { provisionCommandFor } from '../services/threads/spawn-environment-provision.js';
import {
  appendConversationThreadEvent,
  createEnvironment,
  createThread,
  getEnvironment,
  getPrimaryHost,
  getThread,
  listExecutionHosts,
  patchThreadPluginMetadata,
  updateEnvironmentDiscovery,
  updateEnvironmentStatus,
  updateThreadStatus,
  type EnvironmentRow,
  type ThreadRow
} from '@zana-ai/zcc-db';
import {
  buildManagedBranchName,
  type SpawnEnvironmentChoice
} from '@zana-ai/zcc-domain';
import type {
  HarnessModelRoutingV1,
  Persona,
  Project,
  SessionCohort
} from '@zana-ai/zcc-domain/product';
import { BUILTIN_PERSONA_SKILLS, sanitizePersonaSkills } from '@zana-ai/zcc-domain/product';
import { MODERN_SQUAD_PRIVATE_NAMESPACE } from '@zana-ai/zcc-domain/squad-origin';
import { harnessFamilyOf, parseProfile } from '@zana-ai/zcc-domain/launch-provider';
import { threadScope } from '@zana-ai/zcc-domain/thread-runtime';
import { AmbiguousHostError, HostUnavailableError } from './host-hub.js';
import type { ProductHttpContext } from './product-context.js';
import { unmanagedAttachRefusal } from '../services/threads/workspace-path-claims.js';
import { managedPathOnHost } from '../services/threads/host-managed-path.js';
import { providerSkillAllowlist, resolvePersonaSkillSelection } from '../services/threads/persona-skill-selection.js';
import { threadStartCwd } from '../services/threads/thread-start-cwd.js';
import { resolvePersonalTargetPathOnHost } from '../services/threads/host-personal-path.js';
import {
  boundRemoteHostId,
  isRemoteToolProxyActive,
  remoteWorkspacePath,
  resolveHarnessWorkspacePath,
  REMOTE_HOST_DAEMON_REQUIRED,
  REMOTE_HOST_DAEMON_REQUIRED_MESSAGE,
  threadLaunchRemote
} from '../services/threads/remote-tool-proxy.js';
import { resolveSpawnChoiceForHost } from '../services/threads/spawn-choice-for-host.js';
import { toRemoteStartPathHost } from '../services/hosts/host-public.js';
import { listJsonFiles } from './disk-json.js';
import { join } from 'node:path';

export interface SpawnThreadInput {
  projectId: string;
  providerId: string;
  input: string[];
  hostId?: string;
  id?: string;
  environment?: SpawnEnvironmentChoice;
  checkout?: { kind: 'existing'; name: string } | { kind: 'new'; name: string; baseBranch: string };
  cwd?: string;
  title?: string;
  extraArgs?: string[];
  harnessRouting?: HarnessModelRoutingV1;
  personaId?: string;
  headless?: boolean;
  scheduled?: boolean;
  autoCloseOnFinish?: boolean;
  inboxLevel?: 'silent' | 'quiet' | 'loud';
  autonomous?: boolean;
  resumeSessionId?: string;
  executionEnvironment?: 'local' | 'sandbox' | 'microvm';
  sandboxDenyNetwork?: boolean;
  microVmImage?: string;
  microVmCpus?: number;
  microVmMemoryMib?: number;
  reconnectTmuxId?: string;
  resume?: boolean;
  cohort?: SessionCohort;
}

export class ThreadCreateError extends Error {
  /** Extra JSON fields a route may return beside `error` and `message`. */
  details?: Record<string, unknown>;
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ThreadCreateError';
  }
}

function requireProject(ctx: ProductHttpContext, projectId: string): Project {
  const project = ctx.toProjects().find((row) => row.id === projectId);
  if (!project) {
    throw new ThreadCreateError(404, 'unknown-project', 'project is not registered');
  }
  if (!project.path || project.path.length === 0) {
    throw new ThreadCreateError(403, 'cwd-escape', 'project path is not a confined directory');
  }
  return project;
}

export function resolveProviderFamily(providerId: string): ReturnType<typeof harnessFamilyOf> | 'shell' {
  const profile = parseProfile(providerId);
  if (!profile) return null;
  if (profile === 'shell') return 'shell';
  return harnessFamilyOf(profile);
}

type CompactPersona = {
  id: string;
  name: string;
  baseProfile?: string;
  model?: string;
  permissionMode?: Persona['permissionMode'];
  appendSystemPrompt?: string;
  allowedTools?: string[];
  deniedTools?: string[];
  addDirs?: string[];
  mcpServers?: string[];
  initialPrompt?: string;
};

function compactPersona(persona: Persona): CompactPersona {
  return {
    id: persona.id,
    name: persona.name,
    baseProfile: persona.baseProfile,
    model: persona.model,
    permissionMode: persona.permissionMode,
    appendSystemPrompt: persona.appendSystemPrompt,
    allowedTools: persona.allowedTools,
    deniedTools: persona.deniedTools,
    addDirs: persona.addDirs,
    mcpServers: persona.mcpServers,
    initialPrompt: persona.initialPrompt
  };
}

function findPersona(ctx: ProductHttpContext, personaId?: string): Persona | undefined {
  if (!personaId) return undefined;
  const personas = listJsonFiles(join(ctx.dataDir, 'personas')) as Persona[];
  return personas.find((row) => row.id === personaId);
}

function resolvePersona(ctx: ProductHttpContext, personaId?: string): ReturnType<typeof compactPersona> | undefined {
  const persona = findPersona(ctx, personaId);
  return persona ? compactPersona(persona) : undefined;
}

type PersonaSkillSource =
  | { kind: 'none' }
  | { kind: 'unresolvable' }
  | { kind: 'found'; skills: string[] | undefined };

/**
 * Runtime child: the Electron-bound PersonaStore is not importable here. Same precedence
 * (project > user > built-in); a user/project file shadows a built-in and always wins.
 * `unresolvable` = the persona may carry a skill allowlist we cannot read on this path
 * (extension personas live only in the desktop registry; remote-project personas are remote).
 */
function resolvePersonaSkillSource(
  ctx: ProductHttpContext,
  personaId: string | undefined,
  project?: Pick<Project, 'path' | 'remote'>
): PersonaSkillSource {
  if (!personaId) return { kind: 'none' };
  if (personaId.startsWith('ext:')) return { kind: 'unresolvable' };
  const raw = (project && !project.remote
    ? (listJsonFiles(join(project.path, '.zcc', 'personas')) as Persona[]).find((row) => row.id === personaId)
    : undefined) ?? findPersona(ctx, personaId);
  if (raw) {
    // Malformed value is skipped (treated as unset), matching the PersonaStore sanitizer.
    return { kind: 'found', skills: sanitizePersonaSkills(raw.skills) ?? undefined };
  }
  if (Object.hasOwn(BUILTIN_PERSONA_SKILLS, personaId)) {
    return { kind: 'found', skills: [...BUILTIN_PERSONA_SKILLS[personaId]] };
  }
  return project?.remote ? { kind: 'unresolvable' } : { kind: 'none' };
}

/**
 * Non-fatal notice when a supplied persona's skill allowlist could not be applied on this path
 * (the thread launches unrestricted). Undefined when resolved, unknown, or unrestricted.
 */
export function personaSkillAllowlistNotice(
  ctx: ProductHttpContext,
  personaId?: string,
  project?: Pick<Project, 'path' | 'remote'>
): string | undefined {
  if (resolvePersonaSkillSource(ctx, personaId, project).kind !== 'unresolvable') return undefined;
  return `Persona "${personaId}" skill allowlist could not be applied on this launch path; the thread started without a persona skill restriction.`;
}

/**
 * Main-resolved skill selection for a persona-launched thread (no Team, so no lean mode).
 * `{}` when the persona is unknown, unresolvable here, or unrestricted; the renderer never
 * supplies the list. Unresolvable personas are surfaced via `personaSkillAllowlistNotice`.
 */
export function personaThreadSkillFields(
  ctx: ProductHttpContext,
  personaId?: string,
  project?: Pick<Project, 'path' | 'remote'>
): { automatedSkillIds?: string[]; allowedSkillNames?: string[]; providerOptions?: Record<string, unknown> } {
  const source = resolvePersonaSkillSource(ctx, personaId, project);
  if (source.kind !== 'found') return {};
  const skills = source.skills;
  const persona = { skills };
  let selection: ReturnType<typeof resolvePersonaSkillSelection>;
  try {
    selection = resolvePersonaSkillSelection(ctx.dataDir, undefined, persona, 'worker');
  } catch (error) {
    throw new ThreadCreateError(400, 'invalid-persona-skills', error instanceof Error ? error.message : 'invalid persona skills');
  }
  const { automatedSkillIds, allowedSkillNames } = selection;
  if (automatedSkillIds === undefined && allowedSkillNames === undefined) return {};
  const skillAllowlist = providerSkillAllowlist(automatedSkillIds, allowedSkillNames);
  return {
    ...(automatedSkillIds !== undefined ? { automatedSkillIds } : {}),
    ...(allowedSkillNames !== undefined ? { allowedSkillNames } : {}),
    ...(skillAllowlist !== undefined ? { providerOptions: { skillAllowlist } } : {})
  };
}

/**
 * Surface the persona-skill notice as a visible, non-fatal `system/operation` timeline event.
 * Never blocks the launch: any failure to record it is swallowed.
 */
export function emitPersonaSkillNotice(ctx: ProductHttpContext, threadId: string, message: string | undefined): void {
  if (!message) return;
  try {
    const stored = appendConversationThreadEvent(ctx.db, {
      threadId,
      type: 'system/operation',
      payload: {
        type: 'system/operation',
        threadId,
        scope: threadScope(),
        operation: 'persona_skill_allowlist',
        status: 'warning',
        message,
        operationId: `persona-skill-allowlist:${threadId}`
      }
    });
    ctx.hub.emit('threads:event', {
      threadId: stored.threadId,
      sequence: stored.sequence,
      kind: 'thread.event',
      type: stored.type,
      payload: stored.payload
    });
  } catch (error) {
    // Advisory only: never fail the launch, but leave a trace that the notice was not recorded.
    console.warn(`[zcc] persona skill notice not recorded for thread ${threadId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function persistThreadSkillSelection(
  ctx: ProductHttpContext,
  threadId: string,
  fields: { automatedSkillIds?: string[]; allowedSkillNames?: string[] }
): void {
  if (fields.automatedSkillIds === undefined && fields.allowedSkillNames === undefined) return;
  const result = patchThreadPluginMetadata(ctx.db, {
    threadId,
    pluginId: MODERN_SQUAD_PRIVATE_NAMESPACE,
    set: {
      ...(fields.automatedSkillIds !== undefined ? { automatedSkillIds: fields.automatedSkillIds } : {}),
      ...(fields.allowedSkillNames !== undefined ? { allowedSkillNames: fields.allowedSkillNames } : {})
    },
    remove: []
  });
  if (!result.ok) throw new ThreadCreateError(400, 'invalid-persona-skills', 'persona skill selection exceeds metadata limit');
}

function mapHostError(error: unknown): ThreadCreateError {
  if (error instanceof HostUnavailableError) {
    return new ThreadCreateError(503, 'host-unavailable', error.message);
  }
  if (error instanceof AmbiguousHostError) {
    return new ThreadCreateError(409, 'ambiguous-host', error.message);
  }
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code: string }).code);
    const message = error instanceof Error ? error.message : String(error);
    if (code === 'path_not_found') return new ThreadCreateError(400, code, message);
    if (code === 'provider_unavailable') return new ThreadCreateError(503, code, message);
    if (code === 'cwd-escape') return new ThreadCreateError(403, code, message);
    return new ThreadCreateError(502, code, message);
  }
  return new ThreadCreateError(500, 'thread-create-failed', error instanceof Error ? error.message : String(error));
}

function threadTitle(input: SpawnThreadInput, prompt: string[]): string {
  if (input.title?.trim()) return input.title.trim().slice(0, 120);
  if (prompt[0]) return prompt[0].slice(0, 120);
  return parseProfile(input.providerId) === 'shell' ? 'Shell' : 'Agent';
}

const THREAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestedThreadId(input: SpawnThreadInput): string | undefined {
  return input.id && THREAD_ID_RE.test(input.id) ? input.id : undefined;
}

export async function createThreadFromRequest(
  ctx: ProductHttpContext,
  input: SpawnThreadInput
): Promise<ThreadRow> {
  if (!input.projectId) {
    throw new ThreadCreateError(400, 'invalid-project', 'projectId is required');
  }
  if (!input.providerId) {
    throw new ThreadCreateError(400, 'invalid-provider', 'providerId is required');
  }
  const prompt = input.input.map((part) => part.trim()).filter((part) => part.length > 0);

  let project = requireProject(ctx, input.projectId);
  const boundRemote = boundRemoteHostId(project);
  if (boundRemote === null) {
    throw new ThreadCreateError(409, REMOTE_HOST_DAEMON_REQUIRED, REMOTE_HOST_DAEMON_REQUIRED_MESSAGE);
  }
  const remoteToolProxy = isRemoteToolProxyActive(project, boundRemote ?? input.hostId);
  const primary = getPrimaryHost(ctx.db);
  let hostId: string;
  let workspacePath: string;
  try {
    if (boundRemote) {
      hostId = ctx.hostHub.resolveHostId(boundRemote);
    } else if (remoteToolProxy) {
      if (!primary) {
        throw new ThreadCreateError(503, 'host-unavailable', 'This machine’s host daemon is not connected.');
      }
      hostId = ctx.hostHub.resolveHostId(primary.id);
    } else {
      hostId = ctx.hostHub.resolveHostId(input.hostId ?? project.hostId ?? primary?.id);
    }
    ctx.hostHub.ensureHostSessionReady(hostId);
    project = projectOnHost(project, hostId, primary?.id);
    workspacePath = await resolveHarnessWorkspacePath({
      project,
      remoteToolProxy,
      remoteDefaultPath: ctx.config.getConfig().remoteDefaultPath,
      hosts: listExecutionHosts(ctx.db).map(toRemoteStartPathHost),
      probeHostHome: async () => {
        const listing = await ctx.hostHub.callHostOnlineRpc<{ directory: string }>({
          hostId,
          command: { type: 'host.browse_directory' }
        });
        return listing.directory;
      }
    });
  } catch (error) {
    if (error instanceof ProjectSourceUnavailableError) throw new ThreadCreateError(400, 'host-workspace-mismatch', error.message);
    if (error instanceof ThreadCreateError) throw error;
    throw mapHostError(error);
  }

  let choice: SpawnEnvironmentChoice = input.environment ?? { kind: 'unmanaged' };
  if (project.remote) {
    if (choice.kind !== 'unmanaged') {
      throw new ThreadCreateError(403, 'remote-unsupported', 'remote projects can only use this checkout');
    }
    choice = { kind: 'unmanaged' };
  }
  const spawnChoice = resolveSpawnChoiceForHost({
    project,
    choice,
    executionHostId: hostId,
    primaryHostId: primary?.id,
    remoteToolProxy
  });
  if (!spawnChoice.ok) {
    throw new ThreadCreateError(400, spawnChoice.code, spawnChoice.message);
  }
  choice = spawnChoice.choice;
  const dropCwd = spawnChoice.dropCwd;

  if (choice.kind === 'unmanaged' || input.checkout) {
    const refusal = unmanagedAttachRefusal(ctx.db, {
      dataDir: ctx.dataDir,
      checksOutBranch: Boolean(input.checkout),
      hostId,
      path: workspacePath,
      projectId: project.id
    });
    if (refusal) {
      throw new ThreadCreateError(409, refusal.reason, refusal.message);
    }
  }

  if (choice.kind === 'reuse') {
    const existing = getEnvironment(ctx.db, choice.environmentId);
    if (!existing || existing.projectId !== project.id || existing.hostId !== hostId) {
      throw new ThreadCreateError(404, 'unknown-environment', 'environment is not available');
    }
    if (existing.status !== 'ready' || !existing.path) {
      throw new ThreadCreateError(409, 'environment_not_ready', 'environment is not ready');
    }
    const thread = createThread(ctx.db, {
      id: requestedThreadId(input),
      projectId: project.id,
      hostId,
      environmentId: existing.id,
      providerId: input.providerId,
      title: threadTitle(input, prompt),
      status: 'starting'
    });
    try {
      await startThreadOnHost(ctx, { hostId, project, thread, prompt, environmentId: existing.id, input, dropCwd });
      const running = updateThreadStatus(ctx.db, thread.id, 'running') ?? thread;
      ctx.hub.emit('threads:updated', running);
      return running;
    } catch (error) {
      updateThreadStatus(ctx.db, thread.id, 'failed');
      if (error instanceof ProjectSourceUnavailableError) throw new ThreadCreateError(400, 'host-workspace-mismatch', error.message);
    if (error instanceof ThreadCreateError) throw error;
      throw mapHostError(error);
    }
  }

  const environmentId = crypto.randomUUID();
  const managedPath = choice.kind === 'worktree' ? await managedPathOnHost(ctx, hostId, primary?.id, environmentId, project.path) : undefined;
  let personalPath: string | undefined;
  if (choice.kind === 'personal') {
    try {
      personalPath = await resolvePersonalTargetPathOnHost(ctx, hostId, environmentId);
    } catch (error) {
      throw mapHostError(error);
    }
  }

  const created = ctx.db.transaction(() => {
    const path = choice.kind === 'worktree'
      ? managedPath!
      : choice.kind === 'personal'
        ? personalPath!
        : workspacePath;
    const environment = createEnvironment(ctx.db, {
      id: environmentId,
      projectId: project.id,
      hostId,
      path,
      workspaceProvisionType: choice.kind === 'worktree' ? 'managed-worktree' : choice.kind === 'personal' ? 'personal' : 'unmanaged',
      branchName: choice.kind === 'worktree'
        ? buildManagedBranchName({ threadId: environmentId, branchSlug: choice.branchSlug })
        : null,
      baseBranch: choice.kind === 'worktree' ? choice.baseBranch ?? null : null,
      status: 'provisioning'
    });
    const thread = createThread(ctx.db, {
      id: requestedThreadId(input),
      projectId: project.id,
      hostId,
      environmentId: environment.id,
      providerId: input.providerId,
      title: threadTitle(input, prompt),
      status: 'starting'
    });
    return { environment, thread };
  });

  try {
    const provisioned = await ctx.hostHub.callHostOnlineRpc<EnvironmentProvisionResult>({
      hostId,
      command: {
        ...provisionCommandFor(created.environment, project, choice, input.checkout, workspacePath),
        initiator: { threadId: created.thread.id, provisioningId: created.environment.id }
      }
    });
    updateEnvironmentDiscovery(ctx.db, created.environment.id, {
      status: 'ready',
      path: provisioned.path,
      isGitRepo: provisioned.isGitRepo,
      isWorktree: provisioned.isWorktree,
      branchName: provisioned.branchName,
      defaultBranch: provisioned.defaultBranch,
      mergeBaseBranch: provisioned.defaultBranch
    });

    await startThreadOnHost(ctx, {
      hostId,
      project,
      thread: created.thread,
      prompt,
      environmentId: created.environment.id,
      input,
      dropCwd
    });
    const running = updateThreadStatus(ctx.db, created.thread.id, 'running') ?? created.thread;
    ctx.hub.emit('threads:updated', running);
    return running;
  } catch (error) {
    updateThreadStatus(ctx.db, created.thread.id, 'failed');
    updateEnvironmentStatus(ctx.db, created.environment.id, 'failed');
    if (error instanceof ProjectSourceUnavailableError) throw new ThreadCreateError(400, 'host-workspace-mismatch', error.message);
    if (error instanceof ThreadCreateError) throw error;
    throw mapHostError(error);
  }
}

async function startThreadOnHost(
  ctx: ProductHttpContext,
  args: {
    hostId: string;
    project: Project;
    thread: ThreadRow;
    prompt: string[];
    environmentId: string;
    input: SpawnThreadInput;
    dropCwd?: boolean;
  }
): Promise<void> {
  const status = await ctx.hostHub.callHostOnlineRpc<ProviderStatusResult>({
    hostId: args.hostId,
    command: { type: 'provider.status' }
  });
  const family = resolveProviderFamily(args.input.providerId);
  if (family !== 'shell') {
    const provider = status.providers.find((entry) => entry.family === family);
    if (!family || !provider?.installed || !provider.enabled) {
      throw new ThreadCreateError(503, 'provider_unavailable', `provider ${args.input.providerId} is not available on that host`);
    }
  }
  const remoteToolProxy = isRemoteToolProxyActive(args.project, args.hostId);
  const skillFields = personaThreadSkillFields(ctx, args.input.personaId, args.project);
  // Persist with the thread so resume and later turns (read from metadata) stay restricted.
  persistThreadSkillSelection(ctx, args.thread.id, skillFields);
  emitPersonaSkillNotice(ctx, args.thread.id, personaSkillAllowlistNotice(ctx, args.input.personaId, args.project));
  await ctx.hostHub.callHostOnlineRpc<ThreadStartResult>({
    hostId: args.hostId,
    command: {
      type: 'thread.start',
      threadId: args.thread.id,
      environmentId: args.environmentId,
      projectId: args.project.id,
      providerId: args.input.providerId,
      input: args.prompt
        .map((text) => text.trim())
        .filter((text) => text.length > 0)
        .map((text) => ({ type: 'text' as const, text, mentions: [] })),
      cwd: args.dropCwd || (args.project.remote && !remoteToolProxy)
        ? undefined
        : threadStartCwd(getEnvironment(ctx.db, args.environmentId), args.input.cwd),
      title: args.thread.title ?? undefined,
      extraArgs: args.input.extraArgs,
      harnessRouting: args.input.harnessRouting,
      persona: resolvePersona(ctx, args.input.personaId),
      ...skillFields,
      headless: args.input.headless,
      scheduled: args.input.scheduled,
      autoCloseOnFinish: args.input.autoCloseOnFinish,
      inboxLevel: args.input.inboxLevel,
      autonomous: args.input.autonomous,
      resumeSessionId: args.input.resumeSessionId,
      environment: args.project.remote && !remoteToolProxy ? undefined : args.input.executionEnvironment,
      sandboxDenyNetwork: args.input.sandboxDenyNetwork,
      microVmImage: args.input.microVmImage,
      microVmCpus: args.input.microVmCpus,
      microVmMemoryMib: args.input.microVmMemoryMib,
      ...(remoteToolProxy
        ? {
            remote: threadLaunchRemote(
              args.project,
              remoteWorkspacePath(
                args.project,
                remoteToolProxy,
                ctx.config.getConfig().remoteDefaultPath,
                listExecutionHosts(ctx.db).map(toRemoteStartPathHost)
              )
            ),
            remoteToolProxy: true
          }
        : {}),
      reconnectTmuxId: args.input.reconnectTmuxId,
      resume: args.input.resume,
      cohort: args.input.cohort
    }
  });
}

export function getThreadRecord(ctx: ProductHttpContext, id: string): ThreadRow | null {
  return getThread(ctx.db, id);
}

export function threadView(ctx: ProductHttpContext, thread: ThreadRow) {
  const environment = thread.environmentId ? getEnvironment(ctx.db, thread.environmentId) : null;
  return {
    ...thread,
    cwd: environment?.path ?? null,
    branchName: environment?.branchName ?? null,
    isWorktree: environment?.isWorktree ?? false
  };
}
