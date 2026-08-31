import type {
  ComposerCustomization,
  PluginComposerScope,
  PluginFileOpenerRegistration,
  PluginProviderIconRegistration,
  PluginThreadListRegistration
} from '@zana-ai/zcc-plugin-sdk/app';

const FILE_OPENER_PIN_KEY = 'zcc.plugin.fileOpenerPins';
const THREAD_LIST_PIN_KEY = 'zcc.plugin.threadListPin';

/**
 * The main `@zana-ai/zcc-plugin-sdk` entry doesn't export the bare
 * `PluginComposerScope` union or its `kind` literal — pull the scope type from
 * the `/app` subpath (which does) and derive the kind locally.
 */
type PluginComposerScopeKind = PluginComposerScope['kind'];

export function composerCustomizationApplies(
  customization: ComposerCustomization,
  kind: PluginComposerScopeKind
): boolean {
  if (!customization.scopes || customization.scopes.length === 0) return true;
  return customization.scopes.includes(kind);
}

export function composerContributionKey(
  pluginId: string,
  generation: number,
  customizationId: string,
  contributionId: string
): string {
  return `${pluginId}/${generation}/${customizationId}/${contributionId}`;
}

export function resolveProviderIcon(
  providerId: string,
  registrations: readonly PluginProviderIconRegistration[]
): PluginProviderIconRegistration | null {
  return registrations.find((row) => row.providerId === providerId) ?? null;
}

export function fileExtensionOf(path: string): string | null {
  const base = path.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

export function matchingFileOpeners(
  path: string,
  registrations: readonly PluginFileOpenerRegistration[]
): PluginFileOpenerRegistration[] {
  const extension = fileExtensionOf(path);
  if (!extension) return [];
  return registrations.filter((row) => row.extensions.includes(extension));
}

export function readFileOpenerPins(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(FILE_OPENER_PIN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

export function writeFileOpenerPin(extension: string, openerKey: string | null): void {
  if (typeof localStorage === 'undefined') return;
  const next = { ...readFileOpenerPins() };
  if (openerKey === null) delete next[extension];
  else next[extension] = openerKey;
  localStorage.setItem(FILE_OPENER_PIN_KEY, JSON.stringify(next));
}

export function fileOpenerKey(row: PluginFileOpenerRegistration): string {
  return `${row.pluginId}/${row.id}`;
}

export function resolveFileOpener(
  path: string,
  registrations: readonly PluginFileOpenerRegistration[],
  overrideKey?: string | null
): PluginFileOpenerRegistration | null {
  const matches = matchingFileOpeners(path, registrations);
  if (matches.length === 0) return null;
  if (overrideKey === 'host') return null;
  if (overrideKey) {
    const override = matches.find((row) => fileOpenerKey(row) === overrideKey);
    if (override) return override;
  }
  const extension = fileExtensionOf(path);
  const pin = extension ? readFileOpenerPins()[extension] : undefined;
  if (pin === 'host') return null;
  if (pin) {
    const pinned = matches.find((row) => fileOpenerKey(row) === pin);
    if (pinned) return pinned;
  }
  return matches[0] ?? null;
}

export function readThreadListPin(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(THREAD_LIST_PIN_KEY);
}

export function writeThreadListPin(key: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (key === null) localStorage.removeItem(THREAD_LIST_PIN_KEY);
  else localStorage.setItem(THREAD_LIST_PIN_KEY, key);
}

export function resolveActiveThreadList(
  registrations: readonly PluginThreadListRegistration[]
): PluginThreadListRegistration | null {
  if (registrations.length === 0) return null;
  const pin = readThreadListPin();
  if (pin === 'host') return null;
  if (pin) {
    const pinned = registrations.find((row) => `${row.pluginId}/${row.id}` === pin);
    if (pinned) return pinned;
  }
  return registrations[0] ?? null;
}

export function parseDirectiveAttributes(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const attrs: Record<string, string> = {};
  const body = raw.replace(/^\{\s*/, '').replace(/\s*\}$/, '');
  const pattern = /([a-zA-Z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s}"']+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body))) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}

export const MESSAGE_DIRECTIVE_PATTERN =
  /(^|\n)(::([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(\{[^}]*\})?[ \t]*)(?=\n|$)/g;

export interface ParsedMessageDirective {
  name: string;
  source: string;
  attributes: Record<string, string>;
  start: number;
  end: number;
}

export function parseMessageDirectives(text: string): ParsedMessageDirective[] {
  const found: ParsedMessageDirective[] = [];
  const pattern = /(^|\n)(::([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(\{[^}]*\})?[ \t]*)(?=\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const prefix = match[1] ?? '';
    const source = (match[2] ?? '').trim();
    const start = match.index + prefix.length;
    found.push({
      name: match[3] ?? '',
      source,
      attributes: parseDirectiveAttributes(match[4]),
      start,
      end: start + source.length
    });
  }
  return found;
}
