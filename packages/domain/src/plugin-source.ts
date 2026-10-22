/**
 * Parsed `zcc plugin install` source spec. The original spec is retained for
 * display; normalized persistence is authoritative.
 */

export type ParsedGitSelector =
  | { kind: 'ref'; ref: string }
  | { kind: 'range'; range: string; tagPrefix: string };

export type ParsedPluginSource =
  | { kind: 'path'; path: string }
  | { kind: 'builtin'; name: string }
  | {
      kind: 'git';
      url: string;
      spec: string;
      subdir?: string;
      selector: ParsedGitSelector;
    }
  | {
      kind: 'npm';
      name: string;
      spec: string;
      specKind: 'default' | 'exact' | 'tag' | 'range';
    }
  | {
      kind: 'catalog';
      marketplace: string;
      entryId: string;
    };

const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
export const DEFAULT_GIT_REF = 'HEAD';
const GIT_RANGE_SPEC_PREFIX = 'semver:';
const GIT_REF_SPEC_PREFIX = 'ref:';
const BARE_VERSION_SPEC_PATTERN = /^v?\d+(?:\.\d+)*$/u;
const NPM_NAME_PATTERN = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const BUILTIN_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const CATALOG_ENTRY_PATTERN = /^[a-z0-9][a-z0-9-]*@[a-z0-9][a-z0-9-]*$/;

export function isCommitSha(ref: string): boolean {
  return COMMIT_SHA_PATTERN.test(ref);
}

function looksLikeSemverRange(spec: string): boolean {
  if (BARE_VERSION_SPEC_PATTERN.test(spec)) return false;
  return /^[\^~><=*]/.test(spec) || /(?:\bx\b|\bX\b| \|\| | - )/.test(spec);
}

export function parsePluginSource(raw: string): ParsedPluginSource {
  const spec = raw.trim();
  if (!spec) throw new Error('plugin source must not be empty');

  if (spec.startsWith('builtin:')) {
    const name = spec.slice('builtin:'.length);
    if (!BUILTIN_NAME_PATTERN.test(name)) throw new Error(`invalid builtin name "${name}"`);
    return { kind: 'builtin', name };
  }
  if (spec.startsWith('npm:')) {
    const rest = spec.slice('npm:'.length);
    const at = rest.startsWith('@')
      ? rest.indexOf('@', 1)
      : rest.indexOf('@');
    const name = at === -1 ? rest : rest.slice(0, at);
    const requested = at === -1 ? '' : rest.slice(at + 1);
    if (!NPM_NAME_PATTERN.test(name)) throw new Error(`invalid npm package "${name}"`);
    let specKind: 'default' | 'exact' | 'tag' | 'range' = 'default';
    if (requested === '') specKind = 'default';
    else if (looksLikeSemverRange(requested)) specKind = 'range';
    else if (/^\d/.test(requested) || /^v\d/.test(requested)) specKind = 'exact';
    else specKind = 'tag';
    return { kind: 'npm', name, spec: requested, specKind };
  }
  if (spec.startsWith('git:')) {
    const raw = spec.slice('git:'.length);
    const hash = raw.indexOf('#');
    const rest = hash < 0 ? raw : raw.slice(0, hash);
    const options = new URLSearchParams(hash < 0 ? '' : raw.slice(hash + 1));
    for (const key of options.keys()) if (key !== 'subdir' && key !== 'tagPrefix') throw new Error(`unknown git source option "${key}"`);
    const at = rest.lastIndexOf('@');
    const authorityEnd = rest.includes('://') ? rest.indexOf('/', rest.indexOf('://') + 3) : rest.indexOf(':');
    const hasSelector = at >= 0 && authorityEnd >= 0 && at > authorityEnd;
    const url = hasSelector ? rest.slice(0, at) : rest;
    const selectorSpec = hasSelector ? rest.slice(at + 1) : DEFAULT_GIT_REF;
    if (!url) throw new Error('git source requires a url');
    const selector = parseGitSelector(selectorSpec);
    if (options.has('tagPrefix')) {
      if (selector.kind !== 'range') throw new Error('tagPrefix requires a Git version range');
      selector.tagPrefix = options.get('tagPrefix')!;
    }
    return { kind: 'git', url, spec: selectorSpec, selector, ...(options.has('subdir') ? { subdir: options.get('subdir')! } : {}) };
  }
  if (spec.startsWith('path:')) {
    const path = spec.slice('path:'.length);
    if (!path) throw new Error('path source requires a directory');
    return { kind: 'path', path };
  }
  if (CATALOG_ENTRY_PATTERN.test(spec) && spec.includes('@') && !spec.includes('/') && !spec.startsWith('.')) {
    const [entryId, marketplace] = spec.split('@') as [string, string];
    return { kind: 'catalog', marketplace, entryId };
  }
  return { kind: 'path', path: spec };
}

function parseGitSelector(spec: string): ParsedGitSelector {
  if (spec.startsWith(GIT_RANGE_SPEC_PREFIX)) {
    return { kind: 'range', range: spec.slice(GIT_RANGE_SPEC_PREFIX.length), tagPrefix: '' };
  }
  if (spec.startsWith(GIT_REF_SPEC_PREFIX)) {
    return { kind: 'ref', ref: spec.slice(GIT_REF_SPEC_PREFIX.length) };
  }
  if (looksLikeSemverRange(spec)) {
    return { kind: 'range', range: spec, tagPrefix: '' };
  }
  return { kind: 'ref', ref: spec || DEFAULT_GIT_REF };
}
