/**
 * Plugin deep links: `<scheme>://plugin/<pluginId>/<route>?d=<payload>`.
 *
 * A deep link never performs an action. It only asks the renderer to route
 * (pluginId, route, payload) to the named plugin, which must confirm itself.
 * Everything here is pure and total: hostile input yields `{ ok: false }`,
 * never an exception.
 */

/** Scheme of packaged production builds. */
export const DEEP_LINK_PROD_SCHEME = 'zana';
/** Scheme of unpackaged `pnpm run dev` builds. */
export const DEEP_LINK_DEV_SCHEME = 'zana-dev';
/** Every scheme the in-app "Open link" path accepts. */
export const DEEP_LINK_KNOWN_SCHEMES: readonly string[] = [DEEP_LINK_PROD_SCHEME, DEEP_LINK_DEV_SCHEME];

/** Cap on the whole raw link (payload may be percent-encoded, so larger than the payload cap). */
export const DEEP_LINK_MAX_LENGTH = 8192;
/** Cap on the decoded payload. */
export const DEEP_LINK_MAX_PAYLOAD_LENGTH = 4096;
/** Name of the single query parameter that carries the payload. */
export const DEEP_LINK_PAYLOAD_PARAM = 'd';

export interface DeepLink {
  scheme: string;
  pluginId: string;
  /** Normalized: lowercase segments joined by `/`, no leading or trailing slash. */
  route: string;
  /** Decoded opaque payload, or null when the link carries none. */
  payload: string | null;
}

export type DeepLinkRejectReason =
  | 'not-a-string'
  | 'too-long'
  | 'control-characters'
  | 'malformed'
  | 'wrong-scheme'
  | 'bad-plugin-id'
  | 'bad-route'
  | 'bad-query'
  | 'bad-encoding'
  | 'payload-too-long';

export type DeepLinkParseResult = { ok: true; link: DeepLink } | { ok: false; reason: DeepLinkRejectReason };

export interface ParseDeepLinkOptions {
  /** Lowercase schemes to accept. An empty list accepts nothing. */
  acceptSchemes: readonly string[];
}

const LINK_PATTERN = /^([a-z][a-z0-9+.-]*):\/\/plugin\/([^/?#]*)(\/[^?#]*)?(?:\?([^#]*))?$/i;
const PLUGIN_ID_PATTERN = /^[a-z0-9-]+$/;
const ROUTE_PATTERN = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
// Visible ASCII only: base64url plus the `%XX` escapes and `=` padding.
const QUERY_VALUE_PATTERN = /^[\x21-\x7e]*$/;
// eslint-disable-next-line no-control-regex
const CONTROL_PATTERN = /[\u0000-\u0020\u007f-\u009f\u2028\u2029]/;

const reject = (reason: DeepLinkRejectReason): DeepLinkParseResult => ({ ok: false, reason });

/** Strict, total parser. Never throws. */
export function parseDeepLink(raw: unknown, options: ParseDeepLinkOptions): DeepLinkParseResult {
  try {
    if (typeof raw !== 'string') return reject('not-a-string');
    if (raw.length > DEEP_LINK_MAX_LENGTH) return reject('too-long');
    if (CONTROL_PATTERN.test(raw)) return reject('control-characters');
    const match = LINK_PATTERN.exec(raw);
    if (!match) return reject('malformed');
    const scheme = match[1]!.toLowerCase();
    if (!options.acceptSchemes.includes(scheme)) return reject('wrong-scheme');
    const pluginId = match[2]!;
    if (!PLUGIN_ID_PATTERN.test(pluginId)) return reject('bad-plugin-id');
    const route = (match[3] ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!ROUTE_PATTERN.test(route)) return reject('bad-route');
    const payload = parsePayload(match[4]);
    if (!payload.ok) return reject(payload.reason);
    return { ok: true, link: { scheme, pluginId, route, payload: payload.value } };
  } catch {
    return reject('malformed');
  }
}

const rejectAny = (reason: DeepLinkRejectReason): AnyDeepLinkParseResult => ({ ok: false, reason });

export type AnyDeepLinkParseResult = { ok: true; kind: 'plugin'; link: DeepLink } | { ok: false; reason: DeepLinkRejectReason };

/**
 * Parse a plugin link. Never throws.
 */
export function parseAnyDeepLink(raw: unknown, options: ParseDeepLinkOptions): AnyDeepLinkParseResult {
  try {
    const plugin = parseDeepLink(raw, options);
    return plugin.ok ? { ok: true, kind: 'plugin', link: plugin.link } : rejectAny(plugin.reason);
  } catch {
    return rejectAny('malformed');
  }
}

function parsePayload(query: string | undefined): { ok: true; value: string | null } | { ok: false; reason: DeepLinkRejectReason } {
  if (query === undefined || query === '') return { ok: true, value: null };
  const pairs = query.split('&');
  if (pairs.length !== 1) return { ok: false, reason: 'bad-query' };
  const pair = pairs[0]!;
  const eq = pair.indexOf('=');
  if (eq < 0 || pair.slice(0, eq) !== DEEP_LINK_PAYLOAD_PARAM) return { ok: false, reason: 'bad-query' };
  const encoded = pair.slice(eq + 1);
  if (!QUERY_VALUE_PATTERN.test(encoded)) return { ok: false, reason: 'bad-query' };
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return { ok: false, reason: 'bad-encoding' };
  }
  if (decoded.length > DEEP_LINK_MAX_PAYLOAD_LENGTH) return { ok: false, reason: 'payload-too-long' };
  if (CONTROL_PATTERN.test(decoded)) return { ok: false, reason: 'bad-encoding' };
  return { ok: true, value: decoded };
}

/** Build a plugin link (host-side helper for tests and docs; payload is percent-encoded). */
export function formatDeepLink(base: string, pluginId: string, route: string, payload?: string): string {
  const query = payload === undefined ? '' : `?${DEEP_LINK_PAYLOAD_PARAM}=${encodeURIComponent(payload)}`;
  return `${base}plugin/${pluginId}/${route}${query}`;
}

export interface DeepLinkChannel {
  /** Scheme this build owns, or null when it owns none (E2E without an override). */
  scheme: string | null;
  /** Schemes the OS-delivered path (argv / open-url) accepts. */
  acceptSchemes: readonly string[];
  /** `<scheme>://` shown to plugins, or null. */
  base: string | null;
  /** Whether this build may register the scheme with the OS. */
  registerWithOs: boolean;
}

export interface ResolveDeepLinkChannelInput {
  isPackaged: boolean;
  env: Readonly<Record<string, string | undefined>>;
}

/**
 * Pick the scheme for this channel. Packaged builds own the prod scheme, dev
 * builds the dev scheme, and E2E owns none unless a test-only override
 * (`ZCC_E2E_DEEP_LINK_SCHEME`, honoured only under `ZCC_E2E_HOME`) names one.
 * An E2E build never registers with the OS.
 */
export function resolveDeepLinkChannel(input: ResolveDeepLinkChannelInput): DeepLinkChannel {
  const { env } = input;
  if (env.ZCC_E2E_HOME) {
    const override = env.ZCC_E2E_DEEP_LINK_SCHEME?.trim().toLowerCase();
    const scheme = override && /^[a-z][a-z0-9+.-]*$/.test(override) ? override : null;
    return { scheme, acceptSchemes: scheme ? [scheme] : [], base: scheme ? `${scheme}://` : null, registerWithOs: false };
  }
  if (input.isPackaged) {
    return { scheme: DEEP_LINK_PROD_SCHEME, acceptSchemes: [DEEP_LINK_PROD_SCHEME], base: `${DEEP_LINK_PROD_SCHEME}://`, registerWithOs: true };
  }
  return {
    scheme: DEEP_LINK_DEV_SCHEME,
    acceptSchemes: [DEEP_LINK_DEV_SCHEME],
    base: `${DEEP_LINK_DEV_SCHEME}://`,
    registerWithOs: env.ZCC_REGISTER_DEV_PROTOCOL === '1'
  };
}

/** First argv entry that parses as a link for one of `acceptSchemes`, or null. */
export function findDeepLinkInArgv(argv: readonly unknown[], acceptSchemes: readonly string[]): string | null {
  for (const arg of argv) {
    if (typeof arg !== 'string') continue;
    const trimmed = arg.replace(/^"+|"+$/g, '');
    if (parseAnyDeepLink(trimmed, { acceptSchemes }).ok) return trimmed;
  }
  return null;
}

/** Main to renderer push. */
export interface DeepLinkDelivery {
  pluginId: string;
  route: string;
  payload: string | null;
}

export interface DeepLinkConfig {
  base: string | null;
  acceptSchemes: readonly string[];
}

export type DeepLinkOpenResult = { ok: true; pluginId: string; route: string } | { ok: false; reason: DeepLinkRejectReason | 'unavailable' };
