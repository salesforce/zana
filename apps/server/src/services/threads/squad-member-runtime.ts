import { createHash } from 'node:crypto';
import {
  getConversationThread, getEnvironment, getPrimaryHost, nextConversationEventSequence,
  getThreadPluginMetadata, patchThreadPluginMetadata,
  type ConversationThreadRow
} from '@zana-ai/zcc-db';
import {
  SquadMemberControlRequestSchema, SquadMemberDeliveryRequestSchema, SquadMemberRuntimeRequestSchema,
  SquadMemberDeliveryCompletionSchema, type SquadMemberDeliveryCompletion,
  SquadRuntimePreflightRequestSchema,
  SquadRuntimeOperationSchema, SQUAD_RUNTIME_OPERATION_PATH,
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
import { bridgeLaunchForProvider, canonicalThreadProviderId, getThreadProvider, waitForThreadProvider } from './thread-provider-catalog.js';
import { validateProviderModelSelection } from './provider-model-validation.js';
import type { ModernTeamMember } from '../agents/modern-team-launch-tools.js';
import { threadAutomatedSkillIds } from './thread-automated-skill-selection.js';

/** Host-owned namespace. Only trusted IPC (or an authenticated main seam) may write it. */
export const MODERN_SQUAD_BINDING_ORIGIN = MODERN_SQUAD_THREAD_ORIGIN;
const pendingCreates = new WeakMap<object, Map<string, { fingerprint: string; promise: Promise<{ threadId: string }> }>>();
const pendingActivations = new WeakMap<object, Map<string, Promise<{ threadId: string }>>>();
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Public pluginIdSchema rejects '.', so renderer/plugin metadata APIs cannot
// address this row. Same DB metadata store, independent of transcript rewind.
const PRIVATE_BINDING_NAMESPACE = MODERN_SQUAD_PRIVATE_NAMESPACE;

function persistBindingMetadata(ctx: ProductHttpContext, threadId: string, set: JsonObject): void {
  const result = patchThreadPluginMetadata(ctx.db, { threadId, pluginId: PRIVATE_BINDING_NAMESPACE, set, remove: [] });
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
  // Modern bridges currently enforce host/proxy tools only, not all provider-native tools.
  const nativeToolPolicyWired = false;
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
  const reason = !policyInventoryReady ? `plugin tool policy inventory is not ready${inventory.reason ? `: ${inventory.reason}` : ''}`
    : nativeToolPolicyRequired && !nativeToolPolicyWired ? 'Modern provider-native tool policy is not wired'
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
          automatedSkillIds });
      }
    });
    if (thread.id !== request.bindingId) throw new Error('squad runtime did not preserve reserved binding UUID');
    const environment = thread.environmentId ? getEnvironment(ctx.db, thread.environmentId) : null;
    if (!environment?.path) throw new Error('squad member environment is unavailable');
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
  if (metadata.squadStopped === true) return true;
  persistBindingMetadata(ctx, request.bindingId, { squadStopRequested: true });
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
