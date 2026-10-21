import { createHash } from 'node:crypto';

export const PREVIEW_TARGET = Symbol('authorizedPreviewPort');
export const PREVIEW_PROTOCOL = Symbol('negotiatedPreviewProtocol');
export const PREVIEW_PATH = '/_relay/previews';
export const PREVIEW_LIMIT = 32;
export const PREVIEW_TTL = 8 * 60 * 60 * 1000;
export const machinePreviewKey = hostId => createHash('sha256').update(hostId).digest('hex').slice(0, 16);
export const validPreviewPort = port => Number.isInteger(port) && port >= 1024 && port <= 65535;
export const previewPathAllowed = path => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') &&
  !/[\r\n\0\\]/.test(path) && path.length <= 16 * 1024 && !/^\/(?:_connect|_relay|_mobile|internal)(?:\/|\?|$)/.test(path);

export function parsePreviewLabel(label) {
  const match = /^([a-z0-9][a-z0-9-]{1,28}?[a-z0-9])--(?:([a-f0-9]{16})--)?([1-9]\d{3,4})$/.exec(label ?? '');
  if (!match || match[1].includes('--') || !validPreviewPort(Number(match[3])) || label.length > 63) return null;
  return { base: match[1], machine: match[2] ?? null, port: Number(match[3]) };
}

export function previewTargets(value, now = Date.now()) {
  if (!Array.isArray(value) || value.length > PREVIEW_LIMIT) throw new Error('Invalid preview targets');
  const seen = new Set();
  return value.map(item => {
    if (!item || !validPreviewPort(item.port) || seen.has(item.port) || !Number.isSafeInteger(item.expiresAt) || item.expiresAt > now + PREVIEW_TTL + 60_000) throw new Error('Invalid preview target');
    seen.add(item.port);
    return { port: item.port, expiresAt: item.expiresAt };
  }).filter(item => item.expiresAt > now);
}

const secretCookie = name => /^(?:__Host-|__Secure-|zcc_|zana_|session(?:[._-]|$)|better-auth\.)/i.test(name);
const keepCookies = values => values.join('; ').split(';').map(item => item.trim()).filter(item => item && !secretCookie(item.split('=')[0])).join('; ');
const keepSetCookies = values => values.filter(value => !secretCookie(value.split('=')[0].trim())).map(value => value.split(';').filter(part => !/^\s*domain\s*=/i.test(part)).join(';'));

/**
 * The Connect edge authenticates its own session cookies. Keep them off the
 * tunnel, and never let the computer set them or widen a cookie's Domain.
 */
export function edgeCookies(out, response = false) {
  const name = response ? 'set-cookie' : 'cookie';
  if (out[name] === undefined) return out;
  const values = Array.isArray(out[name]) ? out[name] : [out[name]];
  const kept = response ? keepSetCookies(values) : keepCookies(values);
  if (kept.length) out[name] = kept; else delete out[name];
  return out;
}
const skip = new Set(['host', 'connection', 'upgrade', 'content-length', 'transfer-encoding', 'proxy-authorization', 'proxy-authenticate', 'authorization', 'keep-alive', 'te', 'trailer', 'proxy-connection']);
function previewRedirect(value, port) {
  // URL parsing normalizes backslashes and removes tabs. Check the raw value
  // before either can turn a root-relative path into a different authority.
  if (/[\\\u0000-\u0020\u007f]/.test(value)) return null;
  let path = value;
  if (!path.startsWith('/')) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || Number(url.port) !== port) return null;
      path = url.pathname + url.search + url.hash;
    } catch { return null; }
  }
  return path.startsWith('//') ? null : path;
}
export function previewHeaders(input, response = false, port) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Buffer.byteLength(JSON.stringify(input)) > 32 * 1024) throw new Error('Invalid preview headers');
  const out = {};
  const hopHeaders = new Set(String(input.connection ?? '').toLowerCase().split(',').map(value => value.trim()));
  for (const [key, raw] of Object.entries(input)) {
    const name = key.toLowerCase();
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name) || skip.has(name) || hopHeaders.has(name) || /^(?:x-zcc-|x-forwarded-|sec-websocket-)/.test(name)) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    if (values.some(value => typeof value !== 'string' || /[\r\n\0]/.test(value))) throw new Error('Invalid preview header');
    if (name === 'cookie') {
      const value = keepCookies(values);
      if (value) out.cookie = value;
    } else if (name === 'set-cookie') {
      if (!response) continue;
      const cookies = keepSetCookies(values);
      if (cookies.length) out[name] = cookies;
    } else if (name === 'location' && response) {
      const location = previewRedirect(values[0], port);
      if (location) out[name] = location;
    } else if (name === 'origin' && !response) {
      out.origin = `http://127.0.0.1:${port}`;
    } else if (name !== 'set-cookie' && name !== 'cookie') out[name] = values.join(', ');
  }
  if (response) out['cache-control'] = 'private, no-store';
  if (!response) out.host = `127.0.0.1:${port}`;
  return out;
}
