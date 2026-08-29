import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  formatGithubMentionContext,
  githubMentionFallbackItems,
  githubMentionItemsFromList,
  parseGithubMentionId
} from './mentions.mjs';

const execFileAsync = promisify(execFile);

async function ghJson(args, timeoutMs = 8_000) {
  const { stdout } = await execFileAsync('gh', args, { timeout: timeoutMs, maxBuffer: 256 * 1024 });
  return JSON.parse(String(stdout));
}

export default function plugin(zcc) {
  const settings = zcc.settings.define({
    repo: { type: 'string', label: 'Repository (owner/name)' }
  });

  zcc.rpc.method('status', async () => {
    const values = await settings.get();
    return { repo: values.repo ?? '' };
  });

  async function configuredRepo() {
    const values = await settings.get();
    const repo = typeof values.repo === 'string' ? values.repo.trim() : '';
    return repo || null;
  }

  function registerKind(kind) {
    zcc.ui.registerMentionProvider({
      id: kind,
      label: kind === 'pr' ? 'GitHub pull requests' : 'GitHub issues',
      triggers: ['@', '#'],
      async search({ query }) {
        const repo = await configuredRepo();
        if (!repo) return [];
        try {
          const entries = await ghJson([
            kind === 'pr' ? 'pr' : 'issue',
            'list',
            '-R',
            repo,
            '--limit',
            '20',
            '--json',
            'number,title,state'
          ]);
          return githubMentionItemsFromList(kind, query, repo, entries);
        } catch {
          return githubMentionFallbackItems(kind, query, repo);
        }
      },
      async resolve(itemId) {
        const repo = await configuredRepo();
        const parsed = parseGithubMentionId(itemId, repo);
        if (!parsed) throw new Error(`invalid GitHub ${kind} id`);
        try {
          const detail = await ghJson(
            [
              kind === 'pr' ? 'pr' : 'issue',
              'view',
              String(parsed.number),
              '-R',
              parsed.repo,
              '--json',
              'number,title,body,state,author,url'
            ],
            15_000
          );
          return {
            context: formatGithubMentionContext({
              kind,
              repo: parsed.repo,
              number: parsed.number,
              title: detail.title,
              state: detail.state,
              author: detail.author?.login,
              url: detail.url,
              body: typeof detail.body === 'string' ? detail.body : ''
            })
          };
        } catch (error) {
          return {
            context: formatGithubMentionContext({
              kind,
              repo: parsed.repo,
              number: parsed.number,
              detailError: error instanceof Error ? error.message : String(error)
            })
          };
        }
      }
    });
  }

  registerKind('issue');
  registerKind('pr');
}
