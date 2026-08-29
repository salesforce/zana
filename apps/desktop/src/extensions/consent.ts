/**
 * Install-time consent store (P3-D). A disk extension's declared permissions
 * must be CONSENTED by the user before its main runs / panel mounts; an update
 * that WIDENS the declared set re-prompts. This file owns the persisted grant
 * and the widen-diff. Electron-free (like `discovery.ts`) so vitest can import
 * it directly with a `ZCC_EXTENSIONS_DIR` temp dir.
 *
 * Storage: `~/.zcc/extensions/consent.json`, shape:
 *   { "<id>": { "permissions": string[] } }
 * The stored `permissions` is exactly the list the user approved. Consent state
 * is derived by comparing it against the extension's CURRENT manifest-declared
 * permissions:
 *   - no record               → needsConsent: 'new'      (never approved)
 *   - declared ⊄ consented    → needsConsent: 'widened'  (update added perms)
 *   - declared ⊆ consented    → needsConsent: null       (approved; equal/narrowed)
 *
 * A narrowed/equal update is silent — the extension keeps running and the
 * EFFECTIVE grant is `declared ∩ consented` (so a removed permission stops being
 * granted without a reprompt). Built-ins never appear here (they aren't disk
 * exts and bypass consent entirely).
 *
 * Atomic writes mirror the enabled-map (`setExtensionEnabled`): temp + rename.
 */

import { existsSync } from 'node:fs';
import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getExtensionsDir } from './discovery.js';
import type { Result } from '@zana-ai/zcc-domain/product';

/** The per-list scope allowlists an extension's permissions are scoped by. */
export interface ConsentPermissionScopes {
  execAllowlist?: string[];
  fsRoots?: string[];
  egressAllowlist?: string[];
  mcpAllowlist?: string[];
  streamAllowlist?: string[];
  extensionInstallAllowlist?: string[];
}

/** The allowlist keys we diff for scope-widening. */
const SCOPE_KEYS = [
  'execAllowlist',
  'fsRoots',
  'egressAllowlist',
  'mcpAllowlist',
  'streamAllowlist',
  'extensionInstallAllowlist'
] as const;

/** Keep only the known scope keys, each a deduped string[]; drop empties. */
function normalizeScopes(raw: ConsentPermissionScopes | undefined): ConsentPermissionScopes | undefined {
  if (!raw) return undefined;
  const out: ConsentPermissionScopes = {};
  for (const key of SCOPE_KEYS) {
    const list = raw[key];
    if (Array.isArray(list)) {
      const cleaned = [...new Set(list.filter((s): s is string => typeof s === 'string'))];
      if (cleaned.length) out[key] = cleaned;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** One persisted consent record. */
export interface ConsentRecord {
  /** The exact permission list the user approved. */
  permissions: string[];
  /**
   * The scope allowlists (per brokered list) the user approved, snapshotted at
   * grant time. LOAD-BEARING for update-from-repo: the permission TOKENS can be
   * unchanged while a remote update BROADENS a scope (adds a `"*"` wildcard or a
   * new allowlist entry) — a silent privilege escalation the broker would honor
   * live. `consentStateFor` treats any scope broadening vs this snapshot as
   * `'widened'`, forcing a re-prompt. Absent on legacy records (pre-scope
   * consent) — treated as "no scopes approved", so any declared scope re-prompts
   * once, then persists.
   */
  permissionScopes?: ConsentPermissionScopes;
}

export type ConsentMap = Record<string, ConsentRecord>;

/** Why a disk ext needs (re)consent, or null when fully consented. */
export type NeedsConsent = 'new' | 'widened' | null;

function getConsentFile(): string {
  return join(getExtensionsDir(), 'consent.json');
}

/** Read `consent.json`. Missing/malformed → empty map (never throws). */
export async function readConsentMap(): Promise<ConsentMap> {
  const file = getConsentFile();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(await readFile(file, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ConsentMap = {};
    for (const [id, rec] of Object.entries(parsed as Record<string, unknown>)) {
      if (rec && typeof rec === 'object' && !Array.isArray(rec)) {
        const perms = (rec as { permissions?: unknown }).permissions;
        const scopes = (rec as { permissionScopes?: unknown }).permissionScopes;
        const normScopes =
          scopes && typeof scopes === 'object' && !Array.isArray(scopes)
            ? normalizeScopes(scopes as ConsentPermissionScopes)
            : undefined;
        out[id] = {
          permissions: Array.isArray(perms)
            ? perms.filter((p): p is string => typeof p === 'string')
            : [],
          ...(normScopes ? { permissionScopes: normScopes } : {})
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * True when `declared` scopes broaden `granted` scopes for ANY list: a newly
 * introduced `"*"` wildcard, or a concrete allowlist entry the user never
 * approved. A narrowing (fewer entries, or dropping the wildcard) is NOT a
 * widening. A missing `granted` snapshot (legacy record) treats any non-empty
 * declared scope as widening — so a scope-bearing ext re-prompts once, then the
 * grant persists the snapshot. Comparison is exact (case-sensitive) — allowlist
 * entries are bins/hosts/ids, not display strings.
 */
function scopesWidened(
  declared: ConsentPermissionScopes | undefined,
  granted: ConsentPermissionScopes | undefined
): boolean {
  for (const key of SCOPE_KEYS) {
    const want = declared?.[key];
    if (!want || want.length === 0) continue; // nothing declared for this list
    const have = new Set(granted?.[key] ?? []);
    // A "*" the user already approved subsumes everything for this list.
    if (have.has('*')) continue;
    if (want.some((entry) => !have.has(entry))) return true;
  }
  return false;
}

/**
 * Compute consent state for one disk ext given its CURRENT declared permissions
 * (+ optional scope allowlists) and the consent map. Pure — the unit tests hit
 * this directly. A re-prompt (`'widened'`) fires when the declared TOKEN set
 * grows OR any declared SCOPE broadens vs the approved snapshot (the
 * update-from-repo escalation guard).
 */
export function consentStateFor(
  declared: readonly string[] | undefined,
  consent: ConsentMap,
  id: string,
  declaredScopes?: ConsentPermissionScopes
): { consented: boolean; needsConsent: NeedsConsent } {
  const rec = consent[id];
  if (!rec) return { consented: false, needsConsent: 'new' };
  const granted = new Set(rec.permissions);
  const tokenWidened = (declared ?? []).some((p) => !granted.has(p));
  if (tokenWidened) return { consented: false, needsConsent: 'widened' };
  if (scopesWidened(declaredScopes, rec.permissionScopes))
    return { consented: false, needsConsent: 'widened' };
  // Equal or narrowed: approved. (Narrowing needs no reprompt; the effective
  // grant is declared ∩ consented, computed by the GrantProvider.)
  return { consented: true, needsConsent: null };
}

/** The intersection that becomes the EFFECTIVE granted permission set. */
export function effectivePermissions(
  declared: readonly string[] | undefined,
  consent: ConsentMap,
  id: string
): string[] {
  const rec = consent[id];
  if (!rec) return [];
  const granted = new Set(rec.permissions);
  return (declared ?? []).filter((p) => granted.has(p));
}

/**
 * Record the user's consent: persist the CURRENT declared permission list as the
 * approved set for `id`. Called on Approve. Mirrors `setExtensionEnabled`'s
 * atomic write. After this, `consentStateFor` returns `needsConsent:null` until
 * a future update widens the declared set again.
 */
export async function grantConsent(
  id: string,
  declared: readonly string[] | undefined,
  declaredScopes?: ConsentPermissionScopes
): Promise<Result<true>> {
  if (!id) return { ok: false, code: 'BAD_ID', message: 'Missing extension id' };
  const root = getExtensionsDir();
  const file = getConsentFile();
  const map = await readConsentMap();
  map[id] = {
    permissions: [...new Set(declared ?? [])],
    ...(declaredScopes ? { permissionScopes: normalizeScopes(declaredScopes) } : {})
  };
  try {
    await mkdir(root, { recursive: true });
    await atomicWrite(file, JSON.stringify(map, null, 2));
    return { ok: true, value: true };
  } catch (err) {
    return {
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

/** Forget consent for `id` (on uninstall, or an explicit revoke). */
export async function revokeConsent(id: string): Promise<Result<true>> {
  if (!id) return { ok: false, code: 'BAD_ID', message: 'Missing extension id' };
  const file = getConsentFile();
  const map = await readConsentMap();
  if (!(id in map)) return { ok: true, value: true };
  delete map[id];
  try {
    await mkdir(getExtensionsDir(), { recursive: true });
    await atomicWrite(file, JSON.stringify(map, null, 2));
    return { ok: true, value: true };
  } catch (err) {
    return {
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Narrow one token out of `id`'s approved snapshot, leaving the rest consented.
 * The consent twin of `removeExtensionPermission`: when the user removes a
 * declared permission, the manifest narrows (silently, no re-prompt) — so the
 * approved set MUST narrow in lockstep, or a later re-add of the same token
 * would be silently covered by the stale snapshot and skip consent. Unlike
 * `revokeConsent` it PRESERVES the record (the remaining perms stay approved).
 * Idempotent: absent record / token already gone ⇒ `ok` no-op.
 */
export async function pruneConsentedPermission(
  id: string,
  permission: string
): Promise<Result<true>> {
  if (!id) return { ok: false, code: 'BAD_ID', message: 'Missing extension id' };
  const file = getConsentFile();
  const map = await readConsentMap();
  const rec = map[id];
  if (!rec || !rec.permissions.includes(permission)) return { ok: true, value: true };
  rec.permissions = rec.permissions.filter((p) => p !== permission);
  try {
    await mkdir(getExtensionsDir(), { recursive: true });
    await atomicWrite(file, JSON.stringify(map, null, 2));
    return { ok: true, value: true };
  } catch (err) {
    return {
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

async function atomicWrite(file: string, contents: string): Promise<void> {
  const tmp = `${file}.tmp.${randomBytes(4).toString('hex')}`;
  await writeFile(tmp, contents, 'utf-8');
  await rename(tmp, file);
}
