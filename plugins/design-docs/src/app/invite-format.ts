/**
 * Invitation delivery formats: the raw `zccinv1.` code, and a clickable deep link that carries the same code.
 * Parsing here is advisory (display and routing only); the server still validates every token it redeems.
 */
import { PLUGIN_ID } from '../shared/contract.js';

export const TOKEN_PREFIX = 'zccinv1.';
/** Host limits for a deep link: decoded payload and whole link. */
export const MAX_LINK_PAYLOAD = 4096;
export const MAX_LINK = 8192;

/** A deep link request for the Join peer field (`seq` makes repeated identical links distinct). */
export interface JoinRequest {
  seq: number;
  payload: string | null;
}

export interface InviteSummary {
  token: string;
  /** Inviting computer name and fingerprint as carried in the token. */
  name: string;
  fingerprint: string;
  expiresAt: number;
}

export type InviteInput =
  | { kind: 'token'; token: string; summary: InviteSummary }
  /** A code that does not decode here; pass it to the server unchanged, which gives the authoritative error. */
  | { kind: 'opaque'; token: string }
  | { kind: 'invalid'; message: string };

export const LINK_ERROR = 'This invitation link is not valid. Ask for a new one.';
export const NOT_INVITE_LINK = 'This link is not a Design Docs invitation.';
export const EXPIRED_ERROR = 'This invitation expired. Ask for a new one.';

/** The link for `token`, or null when links are unavailable or the token is too long for the host to deliver. */
export function buildInviteLink(base: string | null, token: string): string | null {
  if (!base || token.length > MAX_LINK_PAYLOAD) return null;
  const link = `${base}plugin/${PLUGIN_ID}/join?d=${encodeURIComponent(token)}`;
  return link.length > MAX_LINK ? null : link;
}

function decodeBase64Url(text: string): string | null {
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
    const binary = atob(padded);
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** Read the computer name, fingerprint and expiry out of a token; null when it is not a token this version understands. */
export function summarizeToken(token: string): InviteSummary | null {
  if (!token.startsWith(TOKEN_PREFIX) || !/^[A-Za-z0-9_-]+$/.test(token.slice(TOKEN_PREFIX.length))) return null;
  const json = decodeBase64Url(token.slice(TOKEN_PREFIX.length));
  if (json === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const { name, fp, exp } = parsed as { name?: unknown; fp?: unknown; exp?: unknown };
  if (typeof name !== 'string' || !name || name.length > 64 || /[\u0000-\u001f\u007f]/.test(name)) return null;
  if (typeof fp !== 'string' || !fp || typeof exp !== 'number' || !Number.isFinite(exp)) return null;
  return { token, name, fingerprint: fp, expiresAt: exp };
}

const LINK = /^(?:zana|zana-dev):\/\/plugin\/([a-z0-9-]+)\/([a-z0-9-]+(?:\/[a-z0-9-]+)*)\/?(?:\?(.*))?$/;

/** Extract the token from a pasted invitation link; strict: one known scheme, this plugin's `join` route, a single `d`. */
function tokenFromLink(link: string): { token: string } | { message: string } {
  if (link.length > MAX_LINK) return { message: LINK_ERROR };
  const match = link.match(LINK);
  if (!match) return { message: LINK_ERROR };
  if (match[1] !== PLUGIN_ID || match[2] !== 'join') return { message: NOT_INVITE_LINK };
  const params = (match[3] ?? '').split('&');
  if (params.length !== 1 || !params[0]!.startsWith('d=')) return { message: LINK_ERROR };
  try {
    const token = decodeURIComponent(params[0]!.slice(2));
    return token && token.length <= MAX_LINK_PAYLOAD ? { token } : { message: LINK_ERROR };
  } catch {
    return { message: LINK_ERROR };
  }
}

/** Classify pasted text (a raw code or a full invitation link). */
export function parseInviteInput(raw: string): InviteInput {
  const text = raw.trim();
  const candidate = /^[a-z][a-z0-9-]*:\/\//.test(text) ? tokenFromLink(text) : { token: text };
  if ('message' in candidate) return { kind: 'invalid', message: candidate.message };
  const summary = summarizeToken(candidate.token);
  return summary ? { kind: 'token', token: candidate.token, summary } : { kind: 'opaque', token: candidate.token };
}

/** A deep link payload must decode to a token; anything else is rejected without touching state. */
export function parseJoinPayload(payload: string | null, now = Date.now()): InviteInput {
  if (!payload) return { kind: 'invalid', message: LINK_ERROR };
  const summary = summarizeToken(payload.trim());
  if (!summary) return { kind: 'invalid', message: LINK_ERROR };
  if (summary.expiresAt <= now) return { kind: 'invalid', message: EXPIRED_ERROR };
  return { kind: 'token', token: summary.token, summary };
}
