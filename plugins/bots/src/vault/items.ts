import type { Bot } from '../model.js';

export type VaultKind = 'login' | 'card' | 'contact';
export type BotIdentity = Pick<Bot, 'id' | 'name' | 'createdAt'>;
export type VaultScope = 'all' | string[];
export const contactFields = [
  ['fullName', 'Full name'], ['email', 'Email'], ['phone', 'Phone'], ['address1', 'Street address'],
  ['address2', 'Apartment or suite'], ['city', 'City'], ['region', 'State or region'],
  ['postalCode', 'Postal code'], ['country', 'Country']
] as const;
export interface VaultItem {
  id: string;
  revision: string;
  kind: VaultKind;
  label: string;
  scope: VaultScope;
  sites: string[];
  username?: string;
  hint?: string;
  last4?: string;
  nameOnCard?: string;
  hasCode?: boolean;
  billingContactId?: string;
  contact?: Partial<Record<typeof contactFields[number][0], string>>;
}
export interface SavedItem {
  item: VaultItem;
  fields: Record<string, string>;
}
export const botScopeKey = (bot: BotIdentity) => bot.id + '@' + bot.createdAt;
export const isShared = (item: VaultItem, bot: BotIdentity) => item.scope === 'all' || item.scope.includes(botScopeKey(bot));

export function httpsOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value.includes('://') ? value : 'https://' + value); }
  catch { throw new Error('Enter a valid HTTPS website.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) throw new Error('Enter a valid HTTPS website.');
  return url.origin;
}

function field(value: unknown, label: string, max = 256, literal = false): string {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Invalid ' + label + '.');
  return literal ? value : value.trim();
}
function required(value: string, label: string): string {
  if (!value) throw new Error(label + ' is required.');
  return value;
}
function parseScope(raw: unknown, bots: BotIdentity[]): VaultScope {
  if (raw === 'all') return raw;
  if (!Array.isArray(raw) || !raw.length || raw.length > 200) throw new Error('Choose which bots can use this item.');
  const known = new Set(bots.map(botScopeKey));
  const ids = raw.map(v => { if (typeof v !== 'string' || !known.has(v)) throw new Error('Choose an existing bot.'); return v; });
  return [...new Set(ids)];
}
function validNumber(value: string) {
  if (!/^\d{12,19}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < value.length; i++) {
    let digit = Number(value[value.length - 1 - i]);
    if (i % 2) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function prepareItem(raw: Record<string, unknown>, bots: BotIdentity[], id: string, revision: string, prior?: SavedItem): SavedItem {
  const kind = raw.kind;
  if (kind !== 'login' && kind !== 'card' && kind !== 'contact') throw new Error('Choose an item type.');
  if (prior && prior.item.kind !== kind) throw new Error('The item type cannot be changed.');
  const scope = parseScope(raw.scope, bots);
  const base: VaultItem = { id, revision, kind, scope, sites: [], label: '' };
  const fields = { ...prior?.fields };
  if (kind === 'contact') {
    const contact: VaultItem['contact'] = {};
    for (const [key, label] of contactFields) {
      const value = field(raw[key], label);
      if (value) contact[key] = value;
    }
    return { item: { ...base, label: required(contact.fullName ?? '', 'Full name'), contact }, fields: {} };
  }
  if (kind === 'login') {
    if (!Array.isArray(raw.sites) || !raw.sites.length || raw.sites.length > 20) throw new Error('Enter at least one website (up to 20).');
    const sites = [...new Set(raw.sites.map(v => httpsOrigin(required(field(v, 'website', 2048), 'Website'))))];
    if (raw.password !== undefined) fields.password = field(raw.password, 'password', 4096, true);
    required(fields.password, 'Password');
    return { item: { ...base, sites, label: new URL(sites[0]).host, username: field(raw.username, 'username'), hint: field(raw.hint, 'hint', 500) }, fields };
  }
  if (raw.number !== undefined) fields.number = field(raw.number, 'card number', 32).replace(/[ -]/g, '');
  if (!validNumber(fields.number ?? '')) throw new Error('Enter a valid card number.');
  if (raw.expiry !== undefined) fields.expiry = field(raw.expiry, 'expiry');
  if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(fields.expiry ?? '')) throw new Error('Use MM/YY for the expiry.');
  if (raw.securityCode !== undefined) fields.securityCode = field(raw.securityCode, 'security code');
  if (fields.securityCode && !/^\d{3,4}$/.test(fields.securityCode)) throw new Error('Enter a three- or four-digit security code.');
  const last4 = fields.number.slice(-4);
  return { item: { ...base, last4, label: field(raw.label, 'card nickname') || 'Card', nameOnCard: field(raw.nameOnCard, 'name on card'), billingContactId: field(raw.billingContactId, 'billing contact') || undefined, hasCode: Boolean(fields.securityCode) }, fields };
}
