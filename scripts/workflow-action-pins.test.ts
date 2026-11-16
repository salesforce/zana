import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const { load } = createRequire(import.meta.url)('js-yaml');
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// GitHub's own actions (`actions/*`) are not flagged by the SAST rule
// `third-party-action-not-pinned-to-commit-sha`, so they may stay tag-pinned.
const FIRST_PARTY_OWNER = 'actions';
// Any line whose YAML key is `uses` (bare or quoted, with or without a list dash).
const USES_KEY = /^\s*(?:-\s+)?(["']?)uses\1\s*:/;
// The full shape: key, then a bare, double-quoted or single-quoted ref, then an optional comment of any length.
const USES_LINE = /^\s*(?:-\s+)?(["']?)uses\1\s*:\s*(?:"([^"]+)"|'([^']+)'|([^\s#"']+))\s*(?:#\s*(.*?))?\s*$/;
const PINNED_REF = /^[^/@\s]+\/[^@\s]+@[0-9a-f]{40}$/;
const VERSION_TAG = /^v\d+(?:\.\d+){0,2}$/;

type UsesRef = { file: string; line: number; ref: string; comment: string };
type Scan = { refs: UsesRef[]; unparsed: string[] };

function workflowFiles(): string[] {
  const workflows = join(repoRoot, '.github/workflows');
  const files = readdirSync(workflows)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => join(workflows, name));
  const actions = join(repoRoot, '.github/actions');
  if (existsSync(actions)) {
    for (const name of readdirSync(actions)) {
      for (const file of ['action.yml', 'action.yaml']) {
        const path = join(actions, name, file);
        if (existsSync(path)) files.push(path);
      }
    }
  }
  return files;
}

/** Line scan. Every `uses:` key line is either parsed or reported, never dropped. */
function scanLines(file: string, text: string): Scan {
  const scan: Scan = { refs: [], unparsed: [] };
  text.split(/\r?\n/).forEach((raw, index) => {
    if (!USES_KEY.test(raw)) return;
    const match = raw.match(USES_LINE);
    if (!match) {
      scan.unparsed.push(`${file}:${index + 1} unparsed uses: line: ${raw.trim()}`);
      return;
    }
    const ref = match[2] ?? match[3] ?? match[4];
    scan.refs.push({ file, line: index + 1, ref, comment: match[5] ?? '' });
  });
  return scan;
}

/** Every `uses` value in the parsed YAML: steps, composite-action steps and reusable-workflow jobs. */
function yamlUses(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((item) => yamlUses(item, out));
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'uses') out.push(String(value));
      else yamlUses(value, out);
    }
  }
  return out;
}

/** Fails when the YAML holds a `uses` the line scan did not see (flow mapping, multi-line value…). */
function missedByLineScan(file: string, text: string, scan: Scan): string[] {
  const seen = scan.refs.map((use) => use.ref);
  const missed: string[] = [];
  for (const ref of yamlUses(load(text))) {
    const at = seen.indexOf(ref);
    if (at >= 0) seen.splice(at, 1);
    else missed.push(`${file}: uses: ${ref} is not on a single "uses: <ref>" line`);
  }
  return missed;
}

function classify(ref: string): 'local' | 'first-party' | 'third-party' | 'unknown' {
  if (ref.startsWith('./')) return 'local';
  if (!/^[^/@\s]+\/[^@\s]+@\S+$/.test(ref)) return 'unknown';
  return ref.split('/')[0] === FIRST_PARTY_OWNER ? 'first-party' : 'third-party';
}

function violations(scan: Scan): string[] {
  const problems: string[] = [];
  for (const use of scan.refs) {
    const kind = classify(use.ref);
    const where = `${use.file}:${use.line} ${use.ref}`;
    if (kind === 'unknown') problems.push(`${where}: unrecognised uses: reference`);
    else if (kind !== 'third-party') continue;
    else if (!PINNED_REF.test(use.ref)) problems.push(`${where}: not pinned to a 40-character commit SHA`);
    else if (!VERSION_TAG.test(use.comment.split(/\s+/)[0] ?? '')) {
      problems.push(`${where}: comment must start with the tag, e.g. "# v4"`);
    }
  }
  const lineOf = (problem: string) => Number(problem.match(/^[^:]+:(\d+)/)?.[1]);
  return [...problems, ...scan.unparsed].sort((a, b) => lineOf(a) - lineOf(b));
}

function check(file: string, text: string): string[] {
  const scan = scanLines(file, text);
  return [...violations(scan), ...missedByLineScan(file, text, scan)];
}

const SHA = 'b906affcce14559ad1aafd4ab0e942779e9f58b1';
const steps = (...lines: string[]) => ['jobs:', '  build:', '    steps:', ...lines].join('\n');

describe('third-party GitHub Actions are pinned to commit SHAs', () => {
  it('pins every third-party uses: line in workflows and composite actions, with a # vN comment', () => {
    const files = workflowFiles();
    const all = files.map((path) => {
      const text = readFileSync(path, 'utf8');
      const file = path.slice(repoRoot.length).replace(/\\/g, '/');
      return { scan: scanLines(file, text), problems: check(file, text) };
    });
    expect(all.flatMap(({ scan }) => scan.refs).filter((use) => classify(use.ref) === 'third-party').length).toBeGreaterThan(0);
    expect(all.flatMap(({ problems }) => problems)).toEqual([]);
  });

  it('accepts pinned refs in every quoting style, with a tag-first comment of any length', () => {
    const text = steps(
      `      - uses: pnpm/action-setup@${SHA} # v4`,
      `      - uses: "pnpm/action-setup@${SHA}" # v4 (latest)`,
      `      - 'uses': 'pnpm/action-setup@${SHA}'   #v4.1.0 install pnpm`,
      '      - uses: actions/checkout@v7',
      '      - uses: ./.github/actions/electron-cache',
    );
    expect(check('wf.yml', text)).toEqual([]);
  });

  it('flags unpinned refs whatever comment follows them', () => {
    const text = steps(
      '      - uses: pnpm/action-setup@v4 # install pnpm',
      '      - uses: some/action@main # TODO pin later',
      '      - uses: "pnpm/action-setup@v4"',
      "      - uses: 'softprops/action-gh-release@v3' # v3",
      '      - uses: softprops/action-gh-release@b906aff # v3',
    );
    expect(check('wf.yml', text)).toEqual([
      'wf.yml:4 pnpm/action-setup@v4: not pinned to a 40-character commit SHA',
      'wf.yml:5 some/action@main: not pinned to a 40-character commit SHA',
      'wf.yml:6 pnpm/action-setup@v4: not pinned to a 40-character commit SHA',
      'wf.yml:7 softprops/action-gh-release@v3: not pinned to a 40-character commit SHA',
      'wf.yml:8 softprops/action-gh-release@b906aff: not pinned to a 40-character commit SHA',
    ]);
  });

  it('flags a pinned ref whose comment does not start with the tag', () => {
    const text = steps(
      `      - uses: pnpm/action-setup@${SHA}`,
      `      - uses: pnpm/action-setup@${SHA} # install pnpm (v4)`,
    );
    expect(check('wf.yml', text)).toEqual([
      `wf.yml:4 pnpm/action-setup@${SHA}: comment must start with the tag, e.g. "# v4"`,
      `wf.yml:5 pnpm/action-setup@${SHA}: comment must start with the tag, e.g. "# v4"`,
    ]);
  });

  it('checks reusable-workflow calls at job level, and skips same-repo ones', () => {
    const text = [
      'jobs:',
      '  shared:',
      '    uses: some-org/workflows/.github/workflows/build.yml@main',
      '  pinned:',
      `    uses: some-org/workflows/.github/workflows/build.yml@${SHA} # v2`,
      '  local:',
      '    uses: ./.github/workflows/build.yml',
    ].join('\n');
    expect(check('wf.yml', text)).toEqual([
      'wf.yml:3 some-org/workflows/.github/workflows/build.yml@main: not pinned to a 40-character commit SHA',
    ]);
  });

  it('fails on uses: forms it cannot read instead of dropping them', () => {
    const text = steps(
      '      - uses: >-',
      '          pnpm/action-setup@v4',
      '      - { name: flow, uses: pnpm/action-setup@v4 }',
      '      - uses: docker://alpine:3.20',
      '      - uses: pnpm/action-setup',
      '      - uses: pnpm/action-setup@v4 trailing-garbage',
    );
    expect(check('wf.yml', text)).toEqual([
      'wf.yml:4 >-: unrecognised uses: reference',
      'wf.yml:7 docker://alpine:3.20: unrecognised uses: reference',
      'wf.yml:8 pnpm/action-setup: unrecognised uses: reference',
      'wf.yml:9 unparsed uses: line: - uses: pnpm/action-setup@v4 trailing-garbage',
      'wf.yml: uses: pnpm/action-setup@v4 is not on a single "uses: <ref>" line',
      'wf.yml: uses: pnpm/action-setup@v4 is not on a single "uses: <ref>" line',
      'wf.yml: uses: pnpm/action-setup@v4 trailing-garbage is not on a single "uses: <ref>" line',
    ]);
  });
});
