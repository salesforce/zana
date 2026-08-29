/**
 * Tiny SemVer helpers for plugin `engines.zcc` / `engines.zccPluginSdk` gates.
 * No semver dependency — dotted numeric core only; pre-release suffixes ignored.
 */

export function parseVersion(value: string): [number, number, number] {
  const core = String(value ?? '').trim().split(/[-+]/)[0] ?? '';
  const parts = core.split('.').map((segment) => {
    const n = Number(segment);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  while (parts.length < 3) parts.push(0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  }
  return 0;
}

function cmp(version: string, target: string): number {
  return compareVersions(version, target);
}

/** Whether `version` satisfies a space-separated comparator list (`>=0.1.0 <2`). */
export function satisfiesRange(version: string, range: string): boolean {
  const tokens = range.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((token) => tokenSatisfied(version, token));
}

function tokenSatisfied(version: string, token: string): boolean {
  if (token === '*' || token === 'x' || token === 'X') return true;
  const caret = token.match(/^\^(.+)$/);
  if (caret) {
    const [maj] = parseVersion(caret[1]!);
    const [vMaj] = parseVersion(version);
    return vMaj === maj && cmp(version, caret[1]!) >= 0;
  }
  const tilde = token.match(/^~(.+)$/);
  if (tilde) {
    const [maj, min] = parseVersion(tilde[1]!);
    const [vMaj, vMin] = parseVersion(version);
    return vMaj === maj && vMin === min && cmp(version, tilde[1]!) >= 0;
  }
  const xRange = token.match(/^(\d+)\.(?:x|X|\*)$/);
  if (xRange) return parseVersion(version)[0] === Number(xRange[1]);
  const gte = token.match(/^>=(.+)$/);
  if (gte) return cmp(version, gte[1]!) >= 0;
  const lte = token.match(/^<=(.+)$/);
  if (lte) return cmp(version, lte[1]!) <= 0;
  const gt = token.match(/^>(.+)$/);
  if (gt) return cmp(version, gt[1]!) > 0;
  const lt = token.match(/^<(.+)$/);
  if (lt) return cmp(version, lt[1]!) < 0;
  const eq = token.match(/^=(.+)$/);
  if (eq) return cmp(version, eq[1]!) === 0;
  return cmp(version, token) === 0;
}
