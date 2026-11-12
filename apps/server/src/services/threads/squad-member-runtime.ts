import { createHash } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import {
  getConversationThread, getEnvironment, getPrimaryHost, nextConversationEventSequence,
  getThreadPluginMetadata, patchThreadPluginMetadata,
  type ConversationThreadRow
} from '@zana-ai/zcc-db';
import {
  SquadMemberControlRequestSchema, SquadMemberDeliveryRequestSchema, SquadMemberRuntimeRequestSchema,
  SquadMemberDeliveryCompletionSchema, SquadMemberRetainRequestSchema, type SquadMemberDeliveryCompletion,
  SquadRuntimePreflightRequestSchema, SquadMemberResumeRequestSchema,
  type SquadMemberResumeRequest, type SquadMemberResumeResult,
  SquadRuntimeOperationSchema, SQUAD_RUNTIME_OPERATION_PATH, SQUAD_START_REFUSED_PREFIX,
  type SquadMemberControlRequest, type SquadMemberDeliveryRequest, type SquadMemberDeliveryResult,
  type SquadMemberRuntimeRequest, type SquadMemberStatus,
  type SquadRuntimePreflightRequest, type SquadRuntimePreflightResult
} from '@zana-ai/zcc-contracts/runtime';
import { ProviderStatusResultSchema } from '@zana-ai/zcc-contracts/host-rpc';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { NATIVE_TOOL_POLICY_PROOF_HEADER } from '../../http/native-tool-policy-proof.js';
import { sendJson } from '../../http/json.js';
import { projectOnHost } from '@zana-ai/zcc-domain/project';
import { MODERN_SQUAD_PRIVATE_NAMESPACE, MODERN_SQUAD_THREAD_ORIGIN } from '@zana-ai/zcc-domain/squad-origin';
import type { JsonObject } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';
import { activatePreparedConversation, createConversationFromRequest } from './conversation-create.js';
import { stopConversation, sendConversationTurn } from './conversation-lifecycle.js';
import { admissionRefusal, admitDispatch } from './dispatch-service.js';
import { resumeConversationQueue } from './conversation-deferred-messages.js';
import { resumeConversationStrict, StrictResumeError } from './conversation-host-rpc.js';
import { bridgeLaunchForProvider, canonicalThreadProviderId, getThreadProvider, waitForThreadProvider } from './thread-provider-catalog.js';
import { capabilityRegistry } from '../../plugins/capability-registry.js';
import { validateProviderModelSelection } from './provider-model-validation.js';
import type { ModernTeamMember } from '../agents/modern-team-launch-tools.js';
import { threadAutomatedSkillIds } from './thread-automated-skill-selection.js';
import { personaMcpAllowlistNotice } from './persona-mcp-allowlist.js';
import { emitPersonaMcpNotice } from './persona-notice.js';

/** Host-owned namespace. Only trusted IPC (or an authenticated main seam) may write it. */
export const MODERN_SQUAD_BINDING_ORIGIN = MODERN_SQUAD_THREAD_ORIGIN;
const pendingCreates = new WeakMap<object, Map<string, { fingerprint: string; promise: Promise<{ threadId: string }> }>>();
const pendingActivations = new WeakMap<object, Map<string, Promise<{ threadId: string }>>>();
const pendingResumes = new WeakMap<object, Map<string, { fingerprint: string; promise: Promise<SquadMemberResumeResult> }>>();
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Public pluginIdSchema rejects '.', so renderer/plugin metadata APIs cannot
// address this row. Same DB metadata store, independent of transcript rewind.
const PRIVATE_BINDING_NAMESPACE = MODERN_SQUAD_PRIVATE_NAMESPACE;

function persistBindingMetadata(ctx: ProductHttpContext, threadId: string, set: JsonObject, remove: string[] = []): void {
  const result = patchThreadPluginMetadata(ctx.db, { threadId, pluginId: PRIVATE_BINDING_NAMESPACE, set, remove });
  if (!result.ok) throw new Error('squad runtime metadata exceeds limit');
}

/** Resolve only main-attested private metadata. Public plugin metadata is never authority. A confirmed stop retires the member. */
export function resolveSquadMember(ctx: ProductHttpContext, threadId: string, projectId: string): ModernTeamMember | undefined {
  const stored = getThreadPluginMetadata(ctx.db, threadId, PRIVATE_BINDING_NAMESPACE);
  const metadata = stored.metadata;
  if (stored.corrupt || metadata.squadBinding !== threadId || typeof metadata.squadGeneration !== 'number'
    || metadata.squadStopped === true || !['worker', 'orchestrator'].includes(String(metadata.squadRole))) return undefined;
  try { boundMember(ctx, { bindingId: threadId, generation: metadata.squadGeneration, projectId }); }
  catch { return undefined; }
  return { bindingId: threadId, generation: metadata.squadGeneration, role: metadata.squadRole as ModernTeamMember['role'],
    ...(typeof metadata.squadExecution === 'string' ? { executionId: metadata.squadExecution } : {}) };
}

/** Durable "ever a member": squad origin is host-reserved and immutable, so retired members never regain owner tools. */
export function isSquadMemberThread(ctx: ProductHttpContext, threadId: string): boolean {
  if (getConversationThread(ctx.db, threadId)?.originPluginId === MODERN_SQUAD_BINDING_ORIGIN) return true;
  const stored = getThreadPluginMetadata(ctx.db, threadId, PRIVATE_BINDING_NAMESPACE);
  return stored.corrupt || Object.keys(stored.metadata).length > 0;
}

/** Register before generic host routes. Secret proof is single-use and binds this exact operation body. */
export async function handleMainSquadRuntimeHttp(
  request: IncomingMessage, response: ServerResponse, ctx: ProductHttpContext
): Promise<boolean> {
  if (new URL(request.url ?? '/', 'http://127.0.0.1').pathname !== SQUAD_RUNTIME_OPERATION_PATH) return false;
  if (request.method !== 'POST') { sendJson(response, 405, { error: 'method not allowed' }); return true; }
  if (request.headers.origin || request.headers['sec-fetch-site'] || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')) {
    sendJson(response, 403, { error: 'squad runtime requires trusted local main' }); return true;
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 512 * 1024) { sendJson(response, 413, { error: 'squad runtime body too large' }); return true; }
    chunks.push(Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString('utf8');
  if (!ctx.verifyNativeToolPolicy?.(request.headers[NATIVE_TOOL_POLICY_PROOF_HEADER], body)) {
    sendJson(response, 403, { error: 'squad runtime request is not signed by main' }); return true;
  }
  let input: unknown;
  try { input = JSON.parse(body); } catch { sendJson(response, 400, { error: 'invalid squad runtime JSON' }); return true; }
  const parsed = SquadRuntimeOperationSchema.safeParse(input);
  if (!parsed.success) { sendJson(response, 400, { error: 'invalid squad runtime operation' }); return true; }
  try {
    const operation = parsed.data;
    let value: unknown;
    switch (operation.operation) {
      case 'squad-runtime-preflight': value = await preflightSquadRuntime(ctx, operation.request); break;
      case 'squad-member-create': value = await createSquadMemberConversation(ctx, operation.request); break;
      case 'squad-member-activate': value = await activateSquadMemberConversation(ctx, operation.request); break;
      case 'squad-member-deliver': value = await deliverSquadMemberConversation(ctx, operation.request); break;
      case 'squad-member-delivery-complete': value = completeSquadMemberDelivery(ctx, operation.request); break;
      case 'squad-member-status': value = squadMemberStatus(ctx, operation.request); break;
      case 'squad-member-stop': value = await stopSquadMemberConversation(ctx, operation.request); break;
      case 'squad-member-retain': value = await retainSquadMemberConversation(ctx, operation.request); break;
      case 'squad-member-resume': value = await resumeSquadMemberConversation(ctx, operation.request); break;
    }
    sendJson(response, 200, { value });
  } catch (error) {
    sendJson(response, 409, { error: (error instanceof Error ? error.message : 'squad operation failed').slice(0, 1024) });
  }
  return true;
}

/** Availability is checked on the execution host; missing policy wiring is never an allow. */
export async function preflightSquadRuntime(
  ctx: ProductHttpContext, input: SquadRuntimePreflightRequest
): Promise<SquadRuntimePreflightResult> {
  const request = SquadRuntimePreflightRequestSchema.parse(input);
  const project = ctx.toProjects().find(row => row.id === request.projectId);
  if (!project) throw new Error('squad project is not registered');
  const primary = getPrimaryHost(ctx.db);
  const hostId = ctx.hostHub.resolveHostId(request.hostId ?? project.hostId ?? primary?.id);
  ctx.hostHub.ensureHostSessionReady(hostId);
  projectOnHost(project, hostId, primary?.id);
  if (project.remote) throw new Error('Modern squad runtime requires a local project');
  // The owning plugin service is the only authority: one strict registry read
  // joined with its sealed generations, after startup settles. A second store
  // handle plus per-row re-reads would see a torn mid-activation inventory.
  const inventory = ctx.plugins
    ? await ctx.plugins.toolPolicyReadiness()
    : { ready: false, required: [], reason: 'plugin service is unavailable' };
  const policyInventoryReady = inventory.ready;
  // Veto state comes from the host-owned capability registry, never a constant:
  // wired only when every requested Modern provider advertises an available
  // `tool-before-native` descriptor. Honest per OBL-019; no launch block (D2).
  const requestedProviderIds = [...new Set(request.providerIds.map(canonicalThreadProviderId))];
  const nativeToolPolicyWired = requestedProviderIds.length > 0 && requestedProviderIds.every(providerId =>
    capabilityRegistry
      .describe({ surface: 'modern', harness: providerId, headless: false, hookBase: true })
      .some(descriptor => descriptor.id === 'tool-before-native' && descriptor.available));
  const nativeToolPolicyRequired = request.nativeToolPolicyRequired === true || inventory.required.length > 0;
  const status = ProviderStatusResultSchema.parse(await ctx.hostHub.callHostOnlineRpc({
    hostId, command: { type: 'provider.status' }
  }));
  const providers: SquadRuntimePreflightResult['providers'] = [];
  for (const requested of [...new Set(request.providerIds)]) {
    await waitForThreadProvider(requested);
    const providerId = canonicalThreadProviderId(requested);
    const provider = getThreadProvider(providerId);
    let reason = provider?.unavailableReason;
    if (!provider) reason = 'provider is not registered';
    if (!reason) {
      try { bridgeLaunchForProvider(providerId, ctx.pluginHostArtifacts); }
      catch (error) { reason = error instanceof Error ? error.message : String(error); }
    }
    const installed = status.providers.find(row => canonicalThreadProviderId(row.family) === providerId);
    const extra = status.extraInstalledAgents?.find(row => row.providerId === providerId);
    if (!reason && providerId !== 'fake' && !(installed?.installed && installed.enabled) && !extra?.installed) {
      reason = 'provider is unavailable on the execution host';
    }
    providers.push({ providerId, available: !reason, ...(reason ? { reason: reason.slice(0, 1024) } : {}) });
  }
  // Missing Modern provider-native enforcement is advertised by capability
  // descriptors. It must not prevent an otherwise supported squad from starting.
  const reason = !policyInventoryReady ? `plugin tool policy inventory is not ready${inventory.reason ? `: ${inventory.reason}` : ''}`
    : providers.some(row => !row.available) ? 'one or more Modern providers are unavailable' : undefined;
  if (!reason) for (const selection of request.selections ?? []) {
    const providerId = canonicalThreadProviderId(selection.providerId);
    if (!providers.some(provider => provider.providerId === providerId && provider.available)) throw new Error('Modern selection provider is unavailable');
    if (selection.permissionMode && !getThreadProvider(providerId)?.capabilities.permissionModes.includes(selection.permissionMode)) {
      throw new Error('Modern provider permission mode is unsupported');
    }
    await validateProviderModelSelection(ctx, { hostId, providerId, cwd: project.path, model: selection.model });
  }
  return { ready: !reason, hostId, policyInventoryReady, nativeToolPolicyRequired, nativeToolPolicyWired,
    providers, ...(reason ? { reason } : {}) };
}

function boundMember(ctx: ProductHttpContext, request: SquadMemberControlRequest): {
  thread: ConversationThreadRow; metadata: JsonObject
} {
  SquadMemberControlRequestSchema.parse({ bindingId: request.bindingId, generation: request.generation, projectId: request.projectId });
  const thread = getConversationThread(ctx.db, request.bindingId);
  if (!thread || thread.projectId !== request.projectId || thread.originPluginId !== MODERN_SQUAD_BINDING_ORIGIN) {
    throw new Error('unknown squad member binding');
  }
  const stored = getThreadPluginMetadata(ctx.db, thread.id, PRIVATE_BINDING_NAMESPACE);
  const metadata = stored.metadata;
  if (stored.corrupt || !Object.keys(metadata).length) throw new Error('unknown squad member binding');
  if (metadata.squadBinding !== request.bindingId || metadata.squadGeneration !== request.generation) {
    throw new Error('stale squad member binding generation');
  }
  const project = ctx.toProjects().find(row => row.id === request.projectId);
  const environment = thread.environmentId ? getEnvironment(ctx.db, thread.environmentId) : null;
  if (!project || !environment || environment.projectId !== request.projectId || environment.hostId !== thread.hostId
    || (metadata.squadHost !== thread.hostId) || (metadata.squadEnvironmentPath !== environment.path)) {
    throw new Error('squad member project/environment/host mismatch');
  }
  projectOnHost(project, thread.hostId, getPrimaryHost(ctx.db)?.id);
  return { thread, metadata };
}

export async function createSquadMemberConversation(
  ctx: ProductHttpContext, input: SquadMemberRuntimeRequest
): Promise<{ threadId: string }> {
  const request = SquadMemberRuntimeRequestSchema.parse(input);
  const fingerprint = hash(request);
  let pending = pendingCreates.get(ctx.db);
  if (!pending) { pending = new Map(); pendingCreates.set(ctx.db, pending); }
  const inFlight = pending.get(request.bindingId);
  if (inFlight) {
    if (inFlight.fingerprint !== fingerprint) throw new Error('squad create retry context mismatch');
    return inFlight.promise;
  }
  const existing = getConversationThread(ctx.db, request.bindingId);
  if (existing) {
    const { metadata } = boundMember(ctx, request);
    if (metadata.squadCreateFingerprint !== fingerprint) throw new Error('squad create retry context mismatch');
    if (existing.archivedAt !== null || metadata.squadStopRequested === true || metadata.squadStopped === true || existing.status === 'error') {
      throw new Error('squad member create did not remain live; reserve a new binding');
    }
    return { threadId: existing.id };
  }
  // Reserve before the first await so concurrent retries cannot issue two starts.
  const promise = (async () => {
    const automatedSkillIds = request.automatedSkillIds ?? [];
    const preflight = await preflightSquadRuntime(ctx, { projectId: request.projectId,
      hostId: request.hostId, providerIds: [request.providerId], nativeToolPolicyRequired: request.nativeToolPolicyRequired,
      selections: [{ providerId: request.providerId, model: request.model, permissionMode: request.permissionMode }] });
    if (!preflight.ready) throw new Error(preflight.reason);
    // The member's first turn is dispatched by activation, which does not admit. Admit the
    // start here, once, before any thread or environment exists. A prepared member cannot
    // be held for later, so a wait is a refusal; an admission failure also refuses.
    const refusal = admissionRefusal(await admitDispatch(ctx, {
      projectId: request.projectId, surface: 'modern', entry: 'squad-member-start', origin: 'system',
      prompt: { text: request.prompt }
    }));
    if (refusal) throw new Error(`${SQUAD_START_REFUSED_PREFIX} (${refusal.code}): ${refusal.message}`.slice(0, 1024));
    const thread = await createConversationFromRequest(ctx, {
      id: request.bindingId, projectId: request.projectId, hostId: preflight.hostId, providerId: request.providerId,
      input: [request.prompt], promptInput: [{ type: 'text', text: request.prompt, mentions: [] }], title: request.title,
      visibility: request.role === 'worker' ? 'hidden' : 'visible', originPluginId: MODERN_SQUAD_BINDING_ORIGIN,
      model: request.model, reasoningLevel: request.reasoningLevel, permissionMode: request.permissionMode,
      pluginMetadata: { squadBinding: request.bindingId, squadGeneration: request.generation, squadRole: request.role,
        squadTeam: request.teamId, squadCohort: request.cohortId, squadHost: preflight.hostId,
        squadCreateFingerprint: fingerprint, ...(request.executionId ? { squadExecution: request.executionId } : {}) }
    }, { source: 'main-authorized', projectId: request.projectId, hostId: preflight.hostId, environmentPath: request.worktreePath, prepareOnly: true,
      onCreated: thread => {
        const environment = thread.environmentId ? getEnvironment(ctx.db, thread.environmentId) : null;
        if (!environment?.path) throw new Error('squad member environment is unavailable');
        persistBindingMetadata(ctx, thread.id, { squadBinding: request.bindingId, squadGeneration: request.generation,
          squadHost: preflight.hostId, squadEnvironmentPath: environment.path, squadCreateFingerprint: fingerprint,
          squadRole: request.role, ...(request.executionId ? { squadExecution: request.executionId } : {}),
          automatedSkillIds,
          ...(request.allowedSkillNames !== undefined ? { allowedSkillNames: request.allowedSkillNames } : {}),
          ...(request.mcpAllowlist !== undefined ? { mcpAllowlist: request.mcpAllowlist } : {}) });
      }
    });
    if (thread.id !== request.bindingId) throw new Error('squad runtime did not preserve reserved binding UUID');
    const environment = thread.environmentId ? getEnvironment(ctx.db, thread.environmentId) : null;
    if (!environment?.path) throw new Error('squad member environment is unavailable');
    if (request.mcpAllowlist !== undefined) {
      emitPersonaMcpNotice(ctx, thread.id, personaMcpAllowlistNotice({
        providerId: canonicalThreadProviderId(request.providerId), isolated: true, allowlist: request.mcpAllowlist
      }));
    }
    return { threadId: thread.id };
  })();
  pending.set(request.bindingId, { fingerprint, promise });
  try { return await promise; } finally { pending.delete(request.bindingId); }
}

export async function activateSquadMemberConversation(ctx: ProductHttpContext, input: SquadMemberRuntimeRequest): Promise<{ threadId: string }> {
  const request = SquadMemberRuntimeRequestSchema.parse(input);
  const assertBinding = () => {
    const { metadata } = boundMember(ctx, request);
    if (metadata.squadCreateFingerprint !== hash(request) || metadata.squadStopRequested === true || metadata.squadStopped === true) {
      throw new Error('prepared squad member binding changed or stopped');
    }
    return metadata;
  };
  // assertBinding pins the request to the prepared fingerprint, so an in-flight
  // activation for this binding is always for an identical request: join it.
  const metadata = assertBinding();
  let pending = pendingActivations.get(ctx.db);
  if (!pending) { pending = new Map(); pendingActivations.set(ctx.db, pending); }
  const inFlight = pending.get(request.bindingId);
  if (inFlight) return inFlight;
  // Durable intent is written only at the send boundary; once set, a crash or
  // failure leaves the outcome uncertain and is never blindly re-sent.
  if (metadata.squadActivationStarted === true) {
    if (metadata.squadActivationAccepted === true) return { threadId: request.bindingId };
    throw new Error('squad member activation outcome is uncertain');
  }
  // Reserve before the first await so concurrent retries cannot issue two starts.
  const promise = (async () => {
    const preflight = await preflightSquadRuntime(ctx, { projectId: request.projectId, hostId: request.hostId,
      providerIds: [request.providerId], nativeToolPolicyRequired: request.nativeToolPolicyRequired,
      selections: [{ providerId: request.providerId, model: request.model, permissionMode: request.permissionMode }] });
    if (!preflight.ready) throw new Error(preflight.reason);
    assertBinding();
    await activatePreparedConversation(ctx, { id: request.bindingId, projectId: request.projectId, providerId: request.providerId,
      input: [request.prompt], promptInput: [{ type: 'text', text: request.prompt, mentions: [] }], title: request.title,
      model: request.model, reasoningLevel: request.reasoningLevel, permissionMode: request.permissionMode,
      automatedSkillIds: threadAutomatedSkillIds(ctx.db, request.bindingId) }, () => {
      // Runs synchronously after every pre-send await; failures before here never reached the provider.
      assertBinding();
      persistBindingMetadata(ctx, request.bindingId, { squadActivationStarted: true });
    });
    persistBindingMetadata(ctx, request.bindingId, { squadActivationAccepted: true });
    return { threadId: request.bindingId };
  })();
  pending.set(request.bindingId, promise);
  try { return await promise; } finally { pending.delete(request.bindingId); }
}

/** Indexed event tip is a bounded progress signal, never task-completion authority. */
export function squadMemberStatus(ctx: ProductHttpContext, request: SquadMemberControlRequest): SquadMemberStatus {
  const { thread, metadata } = boundMember(ctx, request);
  const stopped = metadata.squadStopped === true;
  const stopping = metadata.squadStopRequested === true || thread.archivedAt !== null;
  const hostOnline = ctx.hostHub.connectedHostIds().includes(thread.hostId);
  return { ...request, live: (metadata.squadActivationAccepted === true || Boolean(thread.providerThreadId)) && !stopped && !stopping && hostOnline && thread.status !== 'error' && thread.status !== 'stopping',
    status: stopped ? 'stopped' : stopping ? 'stopping' : thread.status, hostOnline, providerStarted: Boolean(thread.providerThreadId),
    ...(thread.providerThreadId ? { providerThreadId: thread.providerThreadId } : {}),
    ...(typeof metadata.squadSessionRestorable === 'boolean' ? { sessionRestorable: metadata.squadSessionRestorable } : {}),
    eventSequence: Math.max(0, nextConversationEventSequence(ctx.db, thread.id) - 1), updatedAt: thread.updatedAt };
}

/** Durable reservation precedes sending. A crash in that gap stays uncertain, never re-sends. */
export async function deliverSquadMemberConversation(
  ctx: ProductHttpContext, input: SquadMemberDeliveryRequest
): Promise<SquadMemberDeliveryResult> {
  const request = SquadMemberDeliveryRequestSchema.parse(input);
  const result = (state: SquadMemberDeliveryResult['state'], reason?: string): SquadMemberDeliveryResult => ({
    bindingId: request.bindingId, generation: request.generation, projectId: request.projectId,
    assignmentId: request.assignmentId, idempotencyKey: request.idempotencyKey, state, ...(reason ? { reason } : {})
  });
  let member: ReturnType<typeof boundMember>;
  try { member = boundMember(ctx, request); }
  catch (error) { return result('rejected', error instanceof Error ? error.message : 'invalid squad binding'); }
  const key = `delivery_${hash(request.idempotencyKey)}`;
  const fingerprint = hash([request.assignmentId, request.message]);
  const receipt = member.metadata[key];
  if (receipt !== undefined) {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return result('rejected', 'invalid delivery receipt');
    if (receipt.fingerprint !== fingerprint) return result('rejected', 'delivery idempotency correlation mismatch');
    return result(receipt.state === 'accepted' ? 'accepted' : receipt.state === 'completed' ? 'completed' : receipt.state === 'rejected' ? 'rejected' : 'uncertain');
  }
  if (member.metadata.squadStopRequested === true || member.metadata.squadStopped === true || member.thread.archivedAt !== null) return result('rejected', 'squad member is stopped');
  // No eviction: deleting receipts could replay an old assignment. Main rotates bindings at the cap.
  if (Object.keys(member.metadata).filter(key => key.startsWith('delivery_')).length >= 128) {
    return result('rejected', 'squad delivery receipt capacity reached');
  }
  const persist = (state: SquadMemberDeliveryResult['state']): SquadMemberDeliveryResult['state'] => {
    // Main can settle the assignment while send admission is still pending.
    const current = boundMember(ctx, request).metadata[key];
    if (current && typeof current === 'object' && !Array.isArray(current) && current.state === 'completed') return 'completed';
    persistBindingMetadata(ctx, request.bindingId, {
      [key]: { fingerprint, state, assignmentId: request.assignmentId, idempotencyKey: request.idempotencyKey }
    });
    return state;
  };
  persist('uncertain');
  try {
    await sendConversationTurn(ctx, request.bindingId, [{ type: 'text', text: request.message, mentions: [] }], 'queue-if-active');
    return result(persist('accepted'));
  } catch (error) {
    // Admission rejection proves no send; other failures may follow queue/host side effects.
    const rejected = error && typeof error === 'object' && 'code' in error && error.code === 'dispatch_rejected';
    const state = persist(rejected ? 'rejected' : 'uncertain');
    return result(state, state === 'completed' ? undefined : rejected ? 'dispatch rejected' : 'delivery outcome is uncertain');
  }
}

/** Receipt projection only. Main retains all claim/report/ledger authority. */
export function completeSquadMemberDelivery(ctx: ProductHttpContext, input: SquadMemberDeliveryCompletion): SquadMemberDeliveryResult {
  const request = SquadMemberDeliveryCompletionSchema.parse(input);
  const { metadata } = boundMember(ctx, request);
  const key = `delivery_${hash(request.idempotencyKey)}`;
  const receipt = metadata[key];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || receipt.assignmentId !== request.assignmentId
    || receipt.idempotencyKey !== request.idempotencyKey
    || !['accepted', 'completed', 'uncertain'].includes(String(receipt.state))) {
    return { ...request, state: 'rejected', reason: 'unknown or mismatched delivery receipt' };
  }
  persistBindingMetadata(ctx, request.bindingId, { [key]: { ...receipt, state: 'completed' } });
  return { ...request, state: 'completed' };
}

export async function stopSquadMemberConversation(ctx: ProductHttpContext, request: SquadMemberControlRequest): Promise<boolean> {
  const { thread, metadata } = boundMember(ctx, request);
  // A stop during an in-flight resume must not take the early return: the resume
  // may have loaded the session on the host. Mark it cancelled so it cannot commit.
  const resumeStarted = metadata.squadResumeStarted;
  if (metadata.squadStopped === true && resumeStarted === undefined) return true;
  persistBindingMetadata(ctx, request.bindingId, {
    squadStopRequested: true, ...(resumeStarted !== undefined ? { squadResumeCancelled: resumeStarted } : {})
  });
  let hostStop: Promise<unknown> | undefined;
  // Keep queue/send cancellation, but retain the RPC outcome that stopConversation swallows.
  await stopConversation({ ...ctx, hostHub: { ...ctx.hostHub,
    callHostOnlineRpc<T = unknown>(input: Parameters<ProductHttpContext['hostHub']['callHostOnlineRpc']>[0]): Promise<T> {
      const result = ctx.hostHub.callHostOnlineRpc<T>(input);
      if (input.hostId === thread.hostId && input.command.type === 'thread.stop' && input.command.threadId === thread.id) {
        hostStop = result;
      }
      return result;
    }
  } }, request.bindingId);
  const confirmation = await hostStop;
  if (!confirmation || typeof confirmation !== 'object' || !('threadId' in confirmation)
    || confirmation.threadId !== thread.id || !('stopped' in confirmation) || confirmation.stopped !== true) {
    throw new Error('squad member host stop was not confirmed');
  }
  boundMember(ctx, request);
  persistBindingMetadata(ctx, request.bindingId, { squadStopped: true });
  return true;
}

/**
 * Idle-sweep hold on a bound member's live session. Server metadata alone never
 * reaches the host daemon, so the timestamp is also pushed as `thread.retain`;
 * the daemon holds the thread only until `retainUntilMs` (0 clears), so a lost
 * release or a crashed server cannot pin a session. Resolves true when the host
 * acknowledged the exact hold, false when the host was unreachable (the stored
 * value lets the caller re-assert on reconnect).
 */
export async function retainSquadMemberConversation(ctx: ProductHttpContext, input: unknown): Promise<boolean> {
  const request = SquadMemberRetainRequestSchema.parse(input);
  const { thread } = boundMember(ctx, request);
  if (request.retainUntilMs > 0) persistBindingMetadata(ctx, request.bindingId, { squadRetainUntil: request.retainUntilMs });
  else persistBindingMetadata(ctx, request.bindingId, {}, ['squadRetainUntil']);
  try {
    const ack = await ctx.hostHub.callHostOnlineRpc<{ threadId?: string; retainUntilMs?: number }>({
      hostId: thread.hostId,
      command: { type: 'thread.retain', threadId: thread.id, retainUntilMs: request.retainUntilMs }
    });
    return ack?.threadId === thread.id && ack.retainUntilMs === request.retainUntilMs;
  } catch (error) {
    // Offline host or a malformed ack: the caller treats `false` as "hold not applied" and retries.
    console.warn('[squad-member-runtime] thread.retain failed', { threadId: thread.id, hostId: thread.hostId, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/** Typed resume failure; `code` is stable for main, message stays bounded. */
export class SquadResumeError extends Error {
  constructor(readonly code: 'WORKTREE_MISSING' | 'NOT_RESUMABLE' | 'STALE_BINDING' | 'RESUME_FAILED' | 'RESUME_CANCELLED' | StrictResumeError['code'], message: string) {
    super(`${code}: ${message}`);
    this.name = 'SquadResumeError';
  }
}

function worktreeAvailable(environmentPath: unknown): boolean {
  if (typeof environmentPath !== 'string' || !environmentPath) return false;
  try { return statSync(realpathSync(environmentPath)).isDirectory(); } catch { return false; }
}

/**
 * Un-retire a confirmed-stopped member on its stored provider session.
 * Stop flags stay set (deliveries and owner tools keep rejecting) until the
 * provider confirms a native load of exactly the expected provider thread; the
 * flags clear and the generation bumps in ONE metadata write. Never session/new.
 * Worktree confinement to a registered project/trusted root is main's job
 * (managed worktrees live outside the project); here the stored environment path
 * is only checked to still exist as a directory (realpath-resolvable). Its
 * equality with the environment row is enforced by boundMember.
 * A stop during the window sets `squadResumeCancelled`; the commit re-checks it
 * and releases the host instead of un-retiring the member.
 */
export async function resumeSquadMemberConversation(
  ctx: ProductHttpContext, input: SquadMemberResumeRequest
): Promise<SquadMemberResumeResult> {
  const request = SquadMemberResumeRequestSchema.parse(input);
  const fingerprint = hash(request);
  let pending = pendingResumes.get(ctx.db);
  if (!pending) { pending = new Map(); pendingResumes.set(ctx.db, pending); }
  const inFlight = pending.get(request.bindingId);
  if (inFlight) {
    if (inFlight.fingerprint !== fingerprint) throw new SquadResumeError('STALE_BINDING', 'squad resume retry context mismatch');
    return inFlight.promise;
  }
  // Reserve before the first await so concurrent resumes join one host load.
  const promise = (async (): Promise<SquadMemberResumeResult> => {
    let member: ReturnType<typeof boundMember>;
    try { member = boundMember(ctx, { bindingId: request.bindingId, generation: request.expectedGeneration, projectId: request.projectId }); }
    catch (error) { throw new SquadResumeError('STALE_BINDING', error instanceof Error ? error.message : 'invalid squad binding'); }
    const { thread, metadata } = member;
    if (metadata.squadStopped !== true) throw new SquadResumeError('NOT_RESUMABLE', 'squad member is not stopped');
    if (thread.archivedAt !== null) throw new SquadResumeError('NOT_RESUMABLE', 'squad member thread is archived');
    if (!thread.providerThreadId || thread.providerThreadId !== request.expectedProviderThreadId) {
      throw new SquadResumeError('NOT_RESUMABLE', 'stored provider thread does not match the snapshot');
    }
    if (request.newGeneration !== request.expectedGeneration + 1) throw new SquadResumeError('STALE_BINDING', 'resume generation must advance by one');
    if (metadata.squadResumeStarted !== undefined && metadata.squadResumeStarted !== request.newGeneration) {
      throw new SquadResumeError('STALE_BINDING', 'a resume to a different generation is already recorded');
    }
    if (!worktreeAvailable(metadata.squadEnvironmentPath)) throw new SquadResumeError('WORKTREE_MISSING', 'retained squad worktree is missing');
    const stopHost = async () => {
      try { await ctx.hostHub.callHostOnlineRpc({ hostId: thread.hostId, command: { type: 'thread.stop', threadId: thread.id } }); }
      catch { /* best effort: a load that never started has nothing to release */ }
    };
    // Record the start (and drop any stale cancel marker) BEFORE any await so a stop
    // arriving from here on is observed. A recorded start means an earlier attempt
    // may have loaded the session: release it first.
    const previouslyStarted = metadata.squadResumeStarted === request.newGeneration;
    persistBindingMetadata(ctx, thread.id, { squadResumeStarted: request.newGeneration }, ['squadResumeCancelled']);
    if (previouslyStarted) await stopHost();
    try {
      const assertCurrent = () => { boundMember(ctx, { bindingId: request.bindingId, generation: request.expectedGeneration, projectId: request.projectId }); };
      await resumeConversationStrict(ctx, thread.id, request.expectedProviderThreadId, assertCurrent);
      // Final check + commit are one synchronous step (no await): nothing can interleave.
      const current = boundMember(ctx, { bindingId: request.bindingId, generation: request.expectedGeneration, projectId: request.projectId });
      if (current.metadata.squadResumeCancelled === request.newGeneration) {
        throw new SquadResumeError('RESUME_CANCELLED', 'squad member was stopped during resume');
      }
      persistBindingMetadata(ctx, thread.id, { squadStopped: false, squadStopRequested: false, squadGeneration: request.newGeneration },
        ['squadResumeStarted', 'squadResumeFailed', 'squadResumeCancelled']);
    } catch (error) {
      await stopHost();
      if (error instanceof SquadResumeError) {
        try { persistBindingMetadata(ctx, thread.id, { squadResumeFailed: error.code }); } catch { /* retire stays in force */ }
        throw error;
      }
      const code = error instanceof StrictResumeError ? error.code : 'RESUME_FAILED';
      try { persistBindingMetadata(ctx, thread.id, { squadResumeFailed: code }); } catch { /* retire stays in force regardless */ }
      throw new SquadResumeError(code, error instanceof Error ? error.message : 'squad member resume failed');
    }
    resumeConversationQueue(ctx, thread.id);
    return { bindingId: request.bindingId, projectId: request.projectId, generation: request.newGeneration,
      providerThreadId: request.expectedProviderThreadId };
  })();
  pending.set(request.bindingId, { fingerprint, promise });
  try { return await promise; } finally { pending.delete(request.bindingId); }
}
