import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PluginApprovalBinding, PluginApprovalRequest, PluginApprovalResult } from '@zana-ai/zcc-plugin-sdk/server';

/** A host-signed approval is good for one use within this window. */
export const PLUGIN_APPROVAL_TTL_MS = 5 * 60_000;
/** Principal of an owner approval for a core-owned (not plugin-owned) action; no plugin id can equal it. */
export const CORE_APPROVAL_PRINCIPAL = 'core:peer-connection';
const MAX_USED = 1024;
const ACTION = /^[a-z][a-z0-9._-]{0,79}$/;
const TOKEN = /^(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/;

export type { PluginApprovalBinding, PluginApprovalRequest, PluginApprovalResult };

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
  return {
    ok: true,
    value: {
      action: row.action, target, targetLabel, subject,
      ...(revision.value ? { revision: revision.value } : {}),
      ...(confirmText.value ? { confirmText: confirmText.value } : {})
    }
  };
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

function signature(secret: string, pluginId: string, binding: PluginApprovalBinding, stamp: string, nonce: string): string {
  const fields = [binding.action, binding.target, binding.targetLabel, binding.subject, binding.revision ?? '', binding.confirmText ?? ''];
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
    if (age < 0 || age > PLUGIN_APPROVAL_TTL_MS || used.has(token)) return false;
    const expected = signature(secret, pluginId, binding.value, stamp, nonce);
    if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
    for (const [key, expires] of used) if (expires <= at) used.delete(key);
    if (used.size >= MAX_USED) used.delete(used.keys().next().value!);
    used.set(token, at + PLUGIN_APPROVAL_TTL_MS);
    return true;
  };
}
