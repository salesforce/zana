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
  return /^[\^~><=*xX0-9.| -]+$/.test(spec) && /[\^~><=*xX|]/.test(spec);
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
    const rest = spec.slice('git:'.length);
    const at = rest.lastIndexOf('@');
    const url = at === -1 ? rest : rest.slice(0, at);
    const selectorSpec = at === -1 ? DEFAULT_GIT_REF : rest.slice(at + 1);
    if (!url) throw new Error('git source requires a url');
    return { kind: 'git', url, spec: selectorSpec, selector: parseGitSelector(selectorSpec) };
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
