/**
 * Publishing a doc as a static site. The panel collects where to publish; the
 * server checks it and briefs an agent thread, which exports, commits and
 * pushes with the user's own git credentials.
 */

export type PublishFolder = 'root' | 'docs';

export interface PublishTarget {
  /** Another repository's clone URL; null publishes to the project's own repository. */
  repo: string | null;
  branch: string;
  folder: PublishFolder;
}

export const MAX_REPO_URL_LENGTH = 300;
export const MAX_BRANCH_LENGTH = 100;

/** `https://host/owner/repo(.git)`, `ssh://git@host/owner/repo.git` or `git@host:owner/repo.git`. */
const REPO_URL = /^(?:(?:https|ssh):\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/|[\w.-]+@([\w.-]+):)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

/** A git branch name: no spaces, `..`, `~^:?*[\`, leading `-` or `/`, trailing `/`, `.` or `.lock`. */
function isBranchName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_BRANCH_LENGTH &&
    /^[\w./-]+$/.test(name) &&
    !name.startsWith('-') &&
    !name.startsWith('/') &&
    !name.endsWith('/') &&
    !name.endsWith('.') &&
    !name.endsWith('.lock') &&
    !name.includes('..') &&
    !name.includes('//')
  );
}

export class PublishTargetError extends Error {}

/** A checked target, or a `PublishTargetError` saying what to fix. */
export function parsePublishTarget(input: { repo?: unknown; branch?: unknown; folder?: unknown }): PublishTarget {
  const repo = typeof input.repo === 'string' ? input.repo.trim() : '';
  if (repo.length > MAX_REPO_URL_LENGTH) throw new PublishTargetError(`repository URL must be at most ${MAX_REPO_URL_LENGTH} characters`);
  if (repo && !REPO_URL.test(repo)) {
    throw new PublishTargetError('repository must be a clone URL such as https://github.com/owner/repo or git@github.com:owner/repo.git');
  }
  const branch = typeof input.branch === 'string' ? input.branch.trim() : '';
  if (!isBranchName(branch)) throw new PublishTargetError('branch must be a valid git branch name, e.g. main or gh-pages');
  const folder = input.folder ?? 'root';
  if (folder !== 'root' && folder !== 'docs') throw new PublishTargetError('folder must be root or docs');
  return { repo: repo || null, branch, folder };
}

/**
 * Where GitHub Pages serves a repository's site: `owner.github.io/repo` on
 * github.com, `host/pages/owner/repo` on GitHub Enterprise. Null when the URL
 * does not name an owner and a repository.
 */
export function pagesUrl(repo: string): string | null {
  const match = repo.trim().match(REPO_URL);
  if (!match) return null;
  const host = (match[1] ?? match[2])!.toLowerCase();
  const [owner, name] = [match[3]!, match[4]!];
  if (host === 'github.com') {
    return name.toLowerCase() === `${owner.toLowerCase()}.github.io` ? `https://${name}/` : `https://${owner}.github.io/${name}/`;
  }
  return `https://${host}/pages/${owner}/${name}/`;
}

export function buildPublishPrompt(args: { doc: { id: string; slug: string; title: string; entryPath: string }; target: PublishTarget }): string {
  const { doc, target } = args;
  const inDocs = target.folder === 'docs';
  const place = `branch ${target.branch}, ${inDocs ? 'folder /docs' : 'its root'}`;
  const where = target.repo ? `the repository ${target.repo}, ${place}` : `this project's repository, ${place}`;
  const steps = target.repo
    ? [
        `1. Export the site into a scratch folder inside this project: zcc design-docs export ${doc.id} --out .zcc/tmp/publish-${doc.slug}`,
        `2. Clone ${target.repo} into a new temporary directory outside the project and check out ${target.branch} (create the branch if the repository does not have it yet).`,
        `3. Copy the exported files into ${inDocs ? 'docs/ of the clone' : 'the root of the clone'}, keeping .nojekyll and zcc-kit/. Then delete the scratch folder.`
      ]
    : [
        `1. Make sure the working tree is on ${target.branch}. If it is on another branch or has uncommitted changes, stop and ask the user before switching.`,
        `2. Export the site: zcc design-docs export ${doc.id} --out ${inDocs ? 'docs' : '.'}`
      ];
  const next = steps.length + 1;
  const expected = target.repo ? pagesUrl(target.repo) : null;
  return [
    `Publish the design doc "${doc.title}" (id ${doc.id}) as a static GitHub Pages site to ${where}. The user asked for this from the Publish button, so committing and pushing is approved.`,
    [
      ...steps,
      `${next}. Commit only the exported files with the message "Publish design doc: ${doc.title.replace(/"/g, "'")}" and push to ${target.branch}. Never force-push or rewrite history; if the push is rejected, pull with rebase once and retry, otherwise stop and report.`,
      `${next + 1}. Do not delete other files in the repository. If the folder holds pages this doc no longer has, list them in your summary instead of deleting them.`
    ].join('\n'),
    `The site opens on ${doc.entryPath}${doc.entryPath === 'index.html' ? '' : '; a static host serves index.html first, so say so if the doc has none'}.`,
    `When you finish, report the commit, the branch and the Pages URL${expected ? ` (expected ${expected})` : ''}. If Pages may not be on yet, tell the user to enable it in the repository settings under Pages: deploy from branch ${target.branch}, folder ${inDocs ? '/docs' : '/ (root)'}. End with ::design-doc{id="${doc.id}"} on its own line.`
  ].join('\n\n');
}
