import type { PublicOrgView } from './types.js';

export type OrgRpc =
  | { ok: true; org: PublicOrgView }
  | { ok: false; error: string; code?: string; org?: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

export function isPublicOrgView(value: unknown): value is PublicOrgView {
  if (!isRecord(value)) return false;
  return (
    typeof value.alias === 'string' &&
    typeof value.username === 'string' &&
    typeof value.orgId === 'string' &&
    typeof value.instanceUrl === 'string' &&
    typeof value.apiVersion === 'string' &&
    typeof value.kind === 'string'
  );
}

function asPublicOrgView(value: PublicOrgView): PublicOrgView {
  return {
    alias: value.alias,
    username: value.username,
    orgId: value.orgId,
    instanceUrl: value.instanceUrl,
    apiVersion: value.apiVersion,
    kind: value.kind,
    isDefault: value.isDefault === true
  };
}

export function parseOrgRpc(payload: unknown): OrgRpc {
  if (!isRecord(payload)) {
    return { ok: false, error: 'Could not connect to a Salesforce org.' };
  }
  if (payload.ok === true && isPublicOrgView(payload.org)) {
    return { ok: true, org: asPublicOrgView(payload.org) };
  }
  return {
    ok: false,
    error: typeof payload.error === 'string' ? payload.error : 'Could not connect to a Salesforce org.',
    code: typeof payload.code === 'string' ? payload.code : undefined,
    org: null
  };
}

export function orgSessionLabel(org: Pick<PublicOrgView, 'alias' | 'kind'> | null | undefined): string | null {
  if (!org?.alias) return null;
  return `${org.alias} (${org.kind})`;
}
