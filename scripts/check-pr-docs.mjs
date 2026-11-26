import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const testPath = /(?:^|\/)(?:__tests__|__fixtures__|e2e|fixtures|test|tests|testing)\/|\.(?:test|spec|stories)\./;
const instructions = /(?:^|\/)(?:AGENTS|CLAUDE)\.md$/;
const productSurface = /^(?:apps\/(?:app|mobile)\/src\/|apps\/server\/src\/http\/|packages\/(?:cli|control-sdk|plugin-sdk|extension-sdk)\/src\/)/;
const settings = /^(?:packages\/domain\/src\/(?:config|settings|harness-config-compatibility|thread-permission-default)\.ts$|packages\/contracts\/src\/project-settings\.ts$|apps\/desktop\/src\/ipc\/(?:config|settings)\.ts$|apps\/server\/src\/(?:project-settings-store\.ts$|services\/config\/))/;
const pluginUIOrCli = /^plugins\/[^/]+\/(?:app\.tsx|cli\.ts|src\/.+\.(?:tsx|css)|src\/cli\.ts)$/;
const pluginManifest = /^plugins\/[^/]+\/package\.json$/;
const guide = /^(?:docs\/.+\.mdx?|website\/content\/docs\/.+\.mdx?|plugins\/[^/]+\/PLUGIN_OVERVIEW\.md|content\/videos\/catalogue\.json)$/;
const readme = /(?:^|\/)README\.mdx?$/i;
const exceptionLabel = 'no-docs-needed';

function isUserFacing({ path, status }, readManifest) {
  if (testPath.test(path) || instructions.test(path) || /\.mdx?$/.test(path)) return false;
  if (pluginManifest.test(path)) {
    const before = status === 'A' ? undefined : readManifest('base', path);
    const after = status === 'D' ? undefined : readManifest('head', path);
    return !isDeepStrictEqual(before, after);
  }
  return productSurface.test(path) || settings.test(path) || pluginUIOrCli.test(path);
}

export function checkDocs(changes, pr, readManifest) {
  const affected = changes.filter(change => isUserFacing(change, readManifest));
  if (affected.length === 0) return { message: 'No changes to covered user-facing paths.' };
  if (changes.some(({ path }) => guide.test(path) && !testPath.test(path) && !instructions.test(path) && !readme.test(path))) {
    return { message: 'The PR updates documentation for a covered user-facing change.' };
  }
  const reason = /^Docs exception reason:([^\r\n]*)/im.exec(pr.body ?? '')?.[1].replace(/<!--.*?-->/g, '').trim();
  const labeled = (pr.labels ?? []).some(label => label.name === exceptionLabel);
  if (labeled && reason) return { message: 'The PR has a labeled docs exception with a reason.' };

  return {
    error: 'Update a user guide in this PR, or add the no-docs-needed label and fill in Docs exception reason in the PR description.',
    affected: affected.map(({ path }) => path)
  };
}

export function parseNameStatus(diff) {
  const fields = diff.split('\0');
  const changes = [];
  for (let index = 0; index < fields.length - 1; index += 2) {
    changes.push({ status: fields[index], path: fields[index + 1] });
  }
  return changes;
}

export function runDocsCheck(eventPath, cwd, output = console) {
  const { pull_request: pr } = JSON.parse(readFileSync(eventPath, 'utf8'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const base = git('merge-base', pr.base.sha, pr.head.sha).trim();
  // Leave rename detection off so a move across scopes checks both paths.
  const changes = parseNameStatus(git('diff', '--name-status', '--no-renames', '-z', base, pr.head.sha, '--'));
  const result = checkDocs(changes, pr, (revision, path) => {
    const sha = revision === 'base' ? base : pr.head.sha;
    const manifest = JSON.parse(git('show', `${sha}:${path}`));
    return manifest.zcc;
  });
  if (result.error) {
    output.error(result.error);
    output.error('Covered files:', result.affected.slice(0, 20).map(path => JSON.stringify(path)).join(', '));
    return 1;
  }
  output.log(result.message);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runDocsCheck(process.env.GITHUB_EVENT_PATH, process.cwd());
}
