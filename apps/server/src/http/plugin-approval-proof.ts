import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PluginApprovalBinding, PluginApprovalRequest, PluginToolApprovalRequest, PluginApprovalResult } from '@zana-ai/zcc-plugin-sdk/server';
import { callControlAsProductServer, productServerHasDesktopCredential } from './cli-agent-ops.js';
import { getConversationThread, getEnvironment, getPrimaryHost } from '@zana-ai/zcc-db';
import type { ProductHttpContext } from './product-context.js';
import { remoteInteractionSurface } from '../services/threads/interaction-surface.js';

/** A host-signed approval is good for one use within this window. */
export const PLUGIN_APPROVAL_TTL_MS = 5 * 60_000;
/** Principal of an owner approval for a core-owned (not plugin-owned) action; no plugin id can equal it. */
export const CORE_APPROVAL_PRINCIPAL = 'core:peer-connection';
const MAX_USED = 1024;
const ACTION = /^[a-z][a-z0-9._-]{0,79}$/;
const TOKEN = /^(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/;

export type { PluginApprovalBinding, PluginApprovalRequest, PluginToolApprovalRequest, PluginApprovalResult };

/** Only host tool dispatch creates this scope; never populated from tool input. */
export interface PluginToolApprovalScope {
  pluginId: string;
  projectId: string;
  identity?: PluginToolApprovalIdentity;
  request: PluginToolApprovalRequest & { threadId: string; invocationId: string };
}

/** Internal invocation-start snapshot, never supplied by plugin tool arguments. */
export interface PluginToolApprovalIdentity {
  hostId: string;
  environmentId: string | null;
  providerId: string;
  providerThreadId: string | null;
  boundarySequence: number;
  hostSession: ReturnType<ProductHttpContext['hostHub']['getSession']> | null;
}

export function capturePluginToolApprovalIdentity(ctx: Pick<ProductHttpContext, 'db'> & Partial<Pick<ProductHttpContext, 'hostHub'>>, threadId: string): PluginToolApprovalIdentity | null {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) return null;
  // A resumed resident session may keep providerThreadId. Persisted lifecycle
  // boundaries revoke old calls without invalidating ordinary streamed output.
  const boundary = ctx.db.sqlite.prepare(`SELECT COALESCE(MAX(sequence), 0) AS sequence FROM thread_events
    WHERE thread_id = ? AND type IN ('thread/identity', 'thread.started', 'turn/started', 'turn/completed', 'system/thread/interrupted')`)
    .get(threadId) as { sequence: number };
  return { hostId: thread.hostId, environmentId: thread.environmentId, providerId: thread.providerId,
    providerThreadId: thread.providerThreadId, boundarySequence: boundary.sequence,
    hostSession: ctx.hostHub?.getSession(thread.hostId) ?? null };
}

/** The open turn's `turn/started` is the youngest boundary event once it lands. */
function latestBoundaryIsOpenTurn(ctx: Pick<ProductHttpContext, 'db'>, threadId: string): boolean {
  const row = ctx.db.sqlite.prepare(`SELECT type FROM thread_events
    WHERE thread_id = ? AND type IN ('thread/identity', 'thread.started', 'turn/started', 'turn/completed', 'system/thread/interrupted')
    ORDER BY sequence DESC LIMIT 1`).get(threadId) as { type: string } | undefined;
  return row?.type === 'turn/started';
}

/**
 * A plugin tool only runs mid-turn, so its own `turn/started` is the authoritative
 * baseline boundary. That event is appended on a path independent of the provider
 * tool-call dispatch, so it can land a few ms after `execute()` begins. Capturing
 * the baseline before it persists pins a stale `boundarySequence`; the later
 * point-in-time liveness recheck then sees the now-present `turn/started` and
 * falsely treats the tool's own turn as a revoking boundary.
 *
 * Wait (bounded) for the open turn's boundary to become the youngest persisted
 * boundary event, then pin the baseline. The sync `capturePluginToolApprovalIdentity`
 * and the liveness recheck stay point-in-time, so cross-turn / restart / revocation
 * detection is unchanged — this only closes the same-turn write-ordering window.
 * On timeout we fall back to an immediate capture (no weaker than prior behaviour).
 */
export async function captureStablePluginToolApprovalIdentity(
  ctx: Pick<ProductHttpContext, 'db'> & Partial<Pick<ProductHttpContext, 'hostHub'>>,
  threadId: string,
  signal?: AbortSignal
): Promise<PluginToolApprovalIdentity | null> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) return null;
  const deadline = Date.now() + 2_000;
  while (!latestBoundaryIsOpenTurn(ctx, threadId)) {
    if (signal?.aborted || Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return capturePluginToolApprovalIdentity(ctx, threadId);
}

/** Re-read authoritative scope before presenting, after waiting, and before consumption. */
export function isPluginToolApprovalScopeLive(ctx: Pick<ProductHttpContext, 'db' | 'projects'> & Partial<Pick<ProductHttpContext, 'hostHub'>>, threadId: string, projectId: string, identity?: PluginToolApprovalIdentity): boolean {
  const thread = getConversationThread(ctx.db, threadId);
  const project = ctx.projects.list().find(row => row.id === projectId);
  const host = getPrimaryHost(ctx.db);
  const environment = thread?.environmentId ? getEnvironment(ctx.db, thread.environmentId) : null;
  if (identity) {
    const current = capturePluginToolApprovalIdentity(ctx, threadId);
    if (!current || current.hostId !== identity.hostId || current.environmentId !== identity.environmentId
      || current.providerId !== identity.providerId || current.providerThreadId !== identity.providerThreadId
      || current.boundarySequence !== identity.boundarySequence || current.hostSession !== identity.hostSession
      || (current.hostSession && current.hostSession.socket.readyState !== current.hostSession.socket.OPEN)) return false;
  }
  return Boolean(thread && project && host && thread.projectId === project.id && thread.hostId === host.id
    && !project.remote && (!project.hostId || project.hostId === host.id) && thread.visibility === 'visible'
    && !remoteInteractionSurface(ctx.db, thread.id) && thread.archivedAt === null
    && (thread.status === 'active' || thread.status === 'starting')
    && (!thread.environmentId || (environment && environment.hostId === host.id && environment.projectId === project.id)));
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Control characters out, whitespace collapsed: what the sheet shows is what was signed. */
function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text && text.length <= max ? text : null;
}

function optional(value: unknown, max: number, field: string): Parsed<string | undefined> {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined };
  const text = clean(value, max);
  return text ? { ok: true, value: text } : { ok: false, error: `${field} must be 1-${max} characters` };
}

export function parsePluginApprovalBinding(raw: unknown): Parsed<PluginApprovalBinding> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'binding must be an object' };
  const row = raw as Record<string, unknown>;
  if (typeof row.action !== 'string' || !ACTION.test(row.action)) {
    return { ok: false, error: 'binding.action must be a lowercase id (letters, digits, ".", "_" or "-")' };
  }
  const target = clean(row.target, 200);
  const targetLabel = clean(row.targetLabel, 200);
  const subject = clean(row.subject, 200);
  if (!target || !targetLabel || !subject) return { ok: false, error: 'binding needs target, targetLabel and subject (1-200 characters)' };
  const revision = optional(row.revision, 128, 'binding.revision');
  if (!revision.ok) return revision;
  const confirmText = optional(row.confirmText, 80, 'binding.confirmText');
  if (!confirmText.ok) return confirmText;
  for (const key of ['threadId', 'invocationId'] as const) {
    if (row[key] !== undefined && (typeof row[key] !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(row[key] as string))) {
      return { ok: false, error: `binding.${key} must be a bounded identifier` };
    }
  }
  if (row.invocationId !== undefined && row.threadId === undefined) return { ok: false, error: 'invocationId requires threadId' };
  return {
    ok: true,
    value: {
      action: row.action, target, targetLabel, subject,
      ...(row.threadId !== undefined ? { threadId: row.threadId as string } : {}),
      ...(row.invocationId !== undefined ? { invocationId: row.invocationId as string } : {}),
      ...(revision.value ? { revision: revision.value } : {}),
      ...(confirmText.value ? { confirmText: confirmText.value } : {})
    }
  };
}

export function parsePluginToolApprovalRequest(raw: unknown): Parsed<PluginToolApprovalRequest> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'request must be an object' };
  const row = raw as Record<string, unknown>;
  const binding = parsePluginApprovalBinding(row.binding);
  if (!binding.ok) return binding;
  const scoped = parsePluginApprovalBinding({ ...binding.value, threadId: row.threadId, invocationId: row.invocationId });
  if (!scoped.ok) return scoped;
  if (!scoped.value.threadId || !scoped.value.invocationId) return { ok: false, error: 'threadId and invocationId required' };
  const original = row.binding as PluginApprovalBinding | undefined;
  if ((original?.threadId !== undefined && original.threadId !== row.threadId)
    || (original?.invocationId !== undefined && original.invocationId !== row.invocationId)) return { ok: false, error: 'approval scope mismatch' };
  const parsed = parsePluginApprovalRequest({ ...row, binding: scoped.value, summary: row.summary ?? row.detail });
  if (!parsed.ok) return parsed;
  const detail = optional(row.detail, 600, 'detail');
  if (!detail.ok) return detail;
  const timeoutMs = row.timeoutMs ?? PLUGIN_APPROVAL_TTL_MS;
  if (!Number.isSafeInteger(timeoutMs) || (timeoutMs as number) <= 0 || (timeoutMs as number) > PLUGIN_APPROVAL_TTL_MS) {
    return { ok: false, error: 'timeoutMs must be a positive integer at most five minutes' };
  }
  return { ok: true, value: { ...parsed.value, threadId: scoped.value.threadId,
    ...(scoped.value.invocationId ? { invocationId: scoped.value.invocationId } : {}), timeoutMs: timeoutMs as number } };
}

export function parsePluginApprovalRequest(raw: unknown): Parsed<PluginApprovalRequest> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'request must be an object' };
  const row = raw as Record<string, unknown>;
  const binding = parsePluginApprovalBinding(row.binding);
  if (!binding.ok) return binding;
  const title = clean(row.title, 120);
  if (!title) return { ok: false, error: 'title must be 1-120 characters' };
  const summary = optional(row.summary, 600, 'summary');
  if (!summary.ok) return summary;
  const confirmLabel = optional(row.confirmLabel, 40, 'confirmLabel');
  if (!confirmLabel.ok) return confirmLabel;
  if (row.details !== undefined && (!Array.isArray(row.details) || row.details.length > 8)) {
    return { ok: false, error: 'details must be at most 8 lines' };
  }
  const details: string[] = [];
  for (const line of (row.details as unknown[] | undefined) ?? []) {
    const text = clean(line, 240);
    if (!text) return { ok: false, error: 'each detail must be 1-240 characters' };
    details.push(text);
  }
  if (row.tone !== undefined && row.tone !== 'default' && row.tone !== 'danger') return { ok: false, error: 'tone must be default or danger' };
  return {
    ok: true,
    value: {
      binding: binding.value, title,
      ...(summary.value ? { summary: summary.value } : {}),
      ...(details.length ? { details } : {}),
      ...(confirmLabel.value ? { confirmLabel: confirmLabel.value } : {}),
      ...(row.tone === 'danger' ? { tone: 'danger' as const } : {})
    }
  };
}

/** No public HTTP/renderer endpoint: only the retained product-server credential can invoke main. */
export async function requestPluginToolApprovalViaControl(dataDir: string, input: PluginToolApprovalScope): Promise<PluginApprovalResult> {
  if (!productServerHasDesktopCredential()) return { approved: false, reason: 'unavailable' };
  const parsed = parsePluginToolApprovalRequest(input.request);
  if (!parsed.ok) return { approved: false, reason: 'invalid' };
  const timeoutMs = parsed.value.timeoutMs!;
  try {
    const response = await callControlAsProductServer(dataDir, 'plugin.toolApproval.request', {
      pluginId: input.pluginId, projectId: input.projectId, ...parsed.value
    }, timeoutMs) as { ok?: boolean; value?: PluginApprovalResult } | null;
    if (response?.ok !== true || !response.value || typeof response.value.approved !== 'boolean') return { approved: false, reason: 'unavailable' };
    const result = response.value;
    if (result.approved) {
      const parts = typeof result.token === 'string' ? result.token.match(TOKEN) : null;
      const now = Date.now();
      if (!parts || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= now
        || Number(parts[1]) > now || result.expiresAt !== Number(parts[1]) + PLUGIN_APPROVAL_TTL_MS) return { approved: false, reason: 'invalid' };
      return { approved: true, token: result.token, expiresAt: result.expiresAt };
    }
    if (!result.approved && !['cancelled', 'denied', 'timeout', 'unavailable', 'busy', 'invalid'].includes(result.reason)) return { approved: false, reason: 'invalid' };
    return { approved: false, reason: result.reason };
  } catch { return { approved: false, reason: 'unavailable' }; }
}

function signature(secret: string, pluginId: string, binding: PluginApprovalBinding, stamp: string, nonce: string): string {
  const fields = [binding.action, binding.target, binding.targetLabel, binding.subject, binding.revision ?? '', binding.confirmText ?? ''];
  if (binding.threadId !== undefined) fields.push(binding.threadId, binding.invocationId ?? '');
  return createHmac('sha256', secret).update(JSON.stringify(['plugin-approval', pluginId, ...fields, stamp, nonce])).digest('hex');
}

/** Desktop main signs after the user approves its sheet; renderers and plugins never hold the secret. */
export function signPluginApproval(secret: string, pluginId: string, binding: PluginApprovalBinding, now = Date.now()): string {
  const stamp = String(now);
  const nonce = randomBytes(16).toString('hex');
  return `${stamp}.${nonce}.${signature(secret, pluginId, binding, stamp, nonce)}`;
}

/**
 * Checks a token against the binding the plugin rebuilt. A matching token is
 * consumed at once, so a retry (or a second action) needs a new approval.
 */
export function createPluginApprovalVerifier(secret: string, now: () => number = Date.now) {
  if (secret.length < 32) throw new Error('Invalid desktop UI signing secret');
  const used = new Map<string, number>();
  return (token: unknown, pluginId: string, rawBinding: unknown): boolean => {
    if (typeof token !== 'string' || token.length > 128 || !pluginId) return false;
    const parts = token.match(TOKEN);
    const binding = parsePluginApprovalBinding(rawBinding);
    if (!parts || !binding.ok) return false;
    const [, stamp, nonce, mac] = parts;
    const at = now();
    const age = at - Number(stamp);
    if (age < 0 || age >= PLUGIN_APPROVAL_TTL_MS || used.has(token)) return false;
    const expected = signature(secret, pluginId, binding.value, stamp, nonce);
    if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
    for (const [key, expires] of used) if (expires <= at) used.delete(key);
    if (used.size >= MAX_USED) return false;
    used.set(token, Number(stamp) + PLUGIN_APPROVAL_TTL_MS);
    return true;
  };
}
