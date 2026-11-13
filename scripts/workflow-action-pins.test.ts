import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// GitHub's own actions (`actions/*`) are not flagged by the SAST rule
// `third-party-action-not-pinned-to-commit-sha`, so they may stay tag-pinned.
const FIRST_PARTY_OWNER = 'actions';
const USES_LINE = /^\s*(?:-\s+)?uses:\s*(\S+)(?:\s+#\s*(\S+))?\s*$/;
const PINNED_REF = /^[^/@\s]+\/[^@\s]+@[0-9a-f]{40}$/;
const VERSION_COMMENT = /^v\d+(?:\.\d+){0,2}$/;

type UsesRef = { file: string; line: number; ref: string; comment?: string };

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

function collectUses(file: string, text: string): UsesRef[] {
  return text.split(/\r?\n/).flatMap((raw, index) => {
    const match = raw.match(USES_LINE);
    return match ? [{ file, line: index + 1, ref: match[1], comment: match[2] }] : [];
  });
}

function isThirdParty(ref: string): boolean {
  if (ref.startsWith('./') || ref.startsWith('docker://')) return false;
  return ref.split('/')[0] !== FIRST_PARTY_OWNER;
}

function unpinned(refs: UsesRef[]): string[] {
  return refs
    .filter((use) => isThirdParty(use.ref))
    .filter((use) => !PINNED_REF.test(use.ref) || !VERSION_COMMENT.test(use.comment ?? ''))
    .map((use) => `${use.file}:${use.line} ${use.ref}`);
}

describe('third-party GitHub Actions are pinned to commit SHAs', () => {
  it('pins every third-party uses: line in workflows and composite actions, with a # vN comment', () => {
    const refs = workflowFiles().flatMap((path) =>
      collectUses(path.slice(repoRoot.length).replace(/\\/g, '/'), readFileSync(path, 'utf8')),
    );
    expect(refs.filter((use) => isThirdParty(use.ref)).length).toBeGreaterThan(0);
    expect(unpinned(refs)).toEqual([]);
  });

  it('flags tag pins, short SHAs and missing version comments, and skips actions/* and local actions', () => {
    const sha = 'b906affcce14559ad1aafd4ab0e942779e9f58b1';
    const text = [
      '      - uses: pnpm/action-setup@v4',
      `      - uses: pnpm/action-setup@${sha} # v4`,
      `        uses: softprops/action-gh-release@${sha}`,
      '        uses: softprops/action-gh-release@b906aff # v3',
      '      - uses: actions/checkout@v7',
      '      - uses: ./.github/actions/electron-cache',
    ].join('\n');
    expect(unpinned(collectUses('wf.yml', text))).toEqual([
      'wf.yml:1 pnpm/action-setup@v4',
      `wf.yml:3 softprops/action-gh-release@${sha}`,
      'wf.yml:4 softprops/action-gh-release@b906aff',
    ]);
  });
});
