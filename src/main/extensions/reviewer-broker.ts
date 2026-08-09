/**
 * ReviewerBroker — the "Approve for me" gate decorator.
 *
 * Wraps PermissionBroker.can(). When the base broker already ALLOWS, passes
 * through unchanged. When the base DENIES, it may (only in 'approveForMe' mode,
 * only for the eligible set, only on a cached reviewer 'approve') downgrade that
 * deny to an allow. It can NEVER upgrade a deterministic deny that the eligible
 * gate excludes, nor bypass the exec basename guard / sensitive-root / grant
 * checks (those all run first, inside the wrapped broker's can()).
 *
 * can() stays SYNCHRONOUS: it reads the reviewer's verdict CACHE (peek). A miss
 * fails closed AND warms the cache in the background, so a repeat approves.
 */
import { basename, isAbsolute } from 'node:path';
import { PermissionBroker } from './permission-broker.js';
import type { PermissionScope } from './permission-broker.js';
import type { ExtensionPermission } from '@zana-ai/zcc-extension-sdk';
import type { ReviewerApprovalService, ReviewerRequest } from '../reviewer-approval.js';

export type ReviewerMode = 'ask' | 'approveForMe' | 'fullAccess';

/** Only these permissions may ever be reviewer-approved. Deterministic. */
const ELIGIBLE = new Set<ExtensionPermission>(['exec', 'fs:read', 'net'] as ExtensionPermission[]);

/**
 * Second, scope-shape eligibility gate. The reviewer can only ever downgrade a
 * deny that the base broker made on GRANT/ALLOWLIST grounds — NEVER one it made
 * on a hard structural guard (exec basename, fs absolute path). A malformed
 * scope (a path-shaped exec bin, a relative fs path) is a deterministic deny the
 * reviewer is not allowed to touch, so it's ineligible here.
 */
function isScopeEligible(scope?: PermissionScope): boolean {
  if (!scope) return true;
  switch (scope.kind) {
    case 'exec': return scope.bin === basename(scope.bin); // no path / shell string
    case 'fs': return isAbsolute(scope.path);              // lexical guard mirror
    case 'net': return true;
    case 'mcp': return false;                              // mcp is not in ELIGIBLE anyway
    case 'stream': return false;                           // stream is reviewer-ineligible
  }
}

function scopeKey(scope?: PermissionScope): string {
  if (!scope) return '';
  switch (scope.kind) {
    case 'exec': return `exec:${scope.bin}`;
    case 'fs': return `fs:${scope.path}`;
    case 'net': return `net:${scope.host}`;
    case 'mcp': return `mcp:${scope.serverId}`;
    case 'stream': return `stream:${scope.endpoint}`;
  }
}
function summarize(permission: string, scope?: PermissionScope): string {
  return scope ? `${permission}: ${scopeKey(scope).split(':').slice(1).join(':')}` : permission;
}

export class ReviewerBroker extends PermissionBroker {
  constructor(
    private readonly inner: PermissionBroker,
    private readonly mode: () => ReviewerMode,
    private readonly reviewer: Pick<ReviewerApprovalService, 'peek'>
  ) {
    // The subclass never uses its own deps; every decision delegates to `inner`.
    // Pass inner's deps through so any inherited method that reads them is consistent.
    super((inner as unknown as { deps: ConstructorParameters<typeof PermissionBroker>[0] }).deps);
  }

  override isBuiltin(moduleId: string): boolean {
    return this.inner.isBuiltin(moduleId);
  }

  override can(moduleId: string, permission: ExtensionPermission, scope?: PermissionScope): boolean {
    const base = this.inner.can(moduleId, permission, scope); // deterministic + audits
    if (base) return true;
    if (this.mode() !== 'approveForMe') return false;
    if (!ELIGIBLE.has(permission)) return false;
    if (!isScopeEligible(scope)) return false; // hard structural denies are untouchable
    const key = `${moduleId}|${permission}|${scopeKey(scope)}`;
    const req: ReviewerRequest = { moduleId, permission, summary: summarize(permission, scope) };
    return this.reviewer.peek(key, req) === 'approve';
  }

  // assert() is inherited: PermissionBroker.assert calls this.can(), which is
  // overridden above, so it picks up the reviewer path automatically.
}
