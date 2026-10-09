import type { PluginAgentConfigureContext, PluginAgentToolContext, ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import type { setupPrMonitor } from './pr-main.js';
import type { PrPanelUiAction } from './realtime.js';
import { SYNC_STATUS_POLL_INTERVAL_MS, type SyncJobState } from './sync-coordinator.js';
import type { MonitoredPr, PrRollupStatus } from './types.js';

type PrMonitorMethods = ReturnType<typeof setupPrMonitor>;
type MutationResult = { ok: boolean; prs?: MonitoredPr[]; error?: string };

export const READ_TOOL_NAMES = ['pr_monitor_list', 'pr_monitor_show'] as const;
export const TOOL_NAMES = [
  ...READ_TOOL_NAMES,
  'pr_monitor_sync',
  'pr_monitor_add',
  'pr_monitor_remove',
  'pr_monitor_update',
  'pr_monitor_retry',
  'pr_monitor_panel'
] as const;

const STATUSES: readonly PrRollupStatus[] = [
  'failed', 'conflict', 'yellow', 'pending', 'review-required', 'integrating', 'green', 'closed-merged', 'closed-abandoned'
];
const DEFAULT_SYNC_WAIT_MS = 60_000;
const BODY_MAX_CHARS = 4_000;

export interface PrMonitorToolDeps {
  methods: Pick<
    PrMonitorMethods,
    'listPrs' | 'pullPr' | 'removePr' | 'markPrAsSeen' | 'markPrAsUnseen' | 'setPrMuted' | 'setPrFavorite'
    | 'assignProject' | 'retryPr'
  >;
  startSync(repos?: string[]): SyncJobState;
  syncStatus(id: number): SyncJobState;
  /** Push the latest list to open PR Monitor views and the nav badge. */
  prsChanged(prs: MonitoredPr[]): void;
  /** Ask an open PR Monitor panel to change what it shows. */
  panelAction(action: PrPanelUiAction): void;
  syncWaitMs?: number;
}

/** Threads started from PR Monitor's own side-panel Agent tab. */
export function isPanelAgentThread(ctx: PluginAgentConfigureContext, pluginId: string): boolean {
  if (ctx.origin?.pluginId !== pluginId) return false;
  const binding = ctx.pluginMetadata?.panelAgent;
  return Boolean(binding) && typeof binding === 'object' && !Array.isArray(binding);
}

export const PANEL_AGENT_INSTRUCTIONS = [
  'You are the PR Monitor assistant, opened from the side panel next to the PR Monitor board.',
  'The board tracks the user\'s GitHub pull requests (via the local gh CLI) with a rollup status per PR:',
  'failed (CI failing), conflict (merge conflict), yellow (checks need attention), pending (checks running),',
  'review-required, integrating, green (ready), closed-merged, closed-abandoned.',
  'Use pr_monitor_list / pr_monitor_show to answer from the board\'s data instead of guessing,',
  'pr_monitor_sync to refresh from GitHub, and pr_monitor_add / pr_monitor_remove / pr_monitor_update /',
  'pr_monitor_retry to change what is tracked. Changes appear on the board immediately.',
  'Use pr_monitor_panel to show the user what you are talking about: filter the board or open a PR\'s details.',
  'Refer to PRs as owner/repo#number.'
].join(' ');

const FAILING_CHECK = /FAIL|ERROR|TIMED_OUT|CANCEL/i;

function summary(pr: MonitoredPr) {
  return {
    ref: `${pr.repo}#${pr.number}`,
    url: pr.url,
    title: pr.title,
    status: pr.status,
    ...(pr.isDraft ? { draft: true } : {}),
    ...(pr.author?.login ? { author: pr.author.login } : {}),
    ...(pr.headRefName ? { branch: `${pr.headRefName} → ${pr.baseRefName}` } : {}),
    failingChecks: pr.checks.filter((check) => check.bucket === 'fail' || FAILING_CHECK.test(check.state)).map((check) => check.name),
    unread: pr.lastSeenAt === 0 || (pr.lastSeenAt ?? pr.addedAt) < pr.lastStatusChange,
    ...(pr.favorite ? { favorite: true } : {}),
    ...(pr.muted ? { muted: true } : {}),
    ...(pr.projectId ? { projectId: pr.projectId } : {}),
    ...(pr.syncError ? { syncError: pr.syncError } : {}),
    lastChecked: pr.lastChecked ? new Date(pr.lastChecked).toISOString() : null
  };
}

function detail(pr: MonitoredPr) {
  const body = pr.body ?? '';
  return {
    ...summary(pr),
    mergeable: pr.mergeable,
    mergeStateStatus: pr.mergeStateStatus,
    checks: pr.checks,
    ...(pr.reviewers ? { reviewers: pr.reviewers } : {}),
    ...(pr.workItem ? { workItem: pr.workItem } : {}),
    body: body.length > BODY_MAX_CHARS ? `${body.slice(0, BODY_MAX_CHARS)}…` : body
  };
}

/** Resolve a PR URL, `owner/repo#123`, or a bare `#123` / `123` that is unique on the board. */
export function resolvePr(prs: MonitoredPr[], ref: unknown): MonitoredPr | { error: string } {
  const text = typeof ref === 'string' ? ref.trim() : typeof ref === 'number' ? String(ref) : '';
  if (!text) return { error: 'Pass a PR URL or owner/repo#number.' };
  const byUrl = prs.find((pr) => pr.url.toLowerCase() === text.toLowerCase());
  if (byUrl) return byUrl;
  const match = /^(?:([^#\s]+)#|#)?(\d+)$/.exec(text);
  if (!match) return { error: `No tracked PR matches "${text}".` };
  const repo = match[1]?.toLowerCase();
  const number = Number(match[2]);
  const hits = prs.filter((pr) => pr.number === number && (!repo || pr.repo.toLowerCase() === repo));
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) return { error: `No tracked PR matches "${text}".` };
  return { error: `"${text}" matches ${hits.map((pr) => `${pr.repo}#${pr.number}`).join(', ')}; pass owner/repo#number.` };
}

export function parsePrUrl(url: string): { host: string; fullName: string; number: number } | null {
  try {
    const parsed = new URL(url);
    const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/.exec(parsed.pathname);
    if (parsed.protocol !== 'https:' || !match) return null;
    return { host: parsed.host, fullName: `${match[1]}/${match[2]}`, number: Number(match[3]) };
  } catch {
    return null;
  }
}

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? '').trim()).filter(Boolean) : [];
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

export function registerPrMonitorTools(zcc: Pick<ZccPluginApi, 'agents'>, deps: PrMonitorToolDeps): void {
  const prRef = { type: 'string', description: 'PR URL, owner/repo#number, or #number when unique on the board.' } as const;

  const mutate = async (run: () => Promise<MutationResult>, url?: string) => {
    const result = await run();
    if (!result.ok) return { ok: false, error: result.error ?? 'PR Monitor could not apply the change.' };
    const prs = result.prs ?? await deps.methods.listPrs();
    deps.prsChanged(prs);
    const pr = url ? prs.find((row) => row.url === url) : undefined;
    return { ok: true, ...(pr ? { pr: summary(pr) } : {}), tracked: prs.length };
  };

  const withPr = async <T>(input: unknown, run: (pr: MonitoredPr) => Promise<T>) => {
    const pr = resolvePr(await deps.methods.listPrs(), record(input).pr);
    return 'error' in pr ? { ok: false, error: pr.error } : run(pr);
  };

  zcc.agents.registerTool({
    name: 'pr_monitor_list',
    description:
      'List the pull requests tracked on the PR Monitor board with their rollup status, failing checks and unread state. ' +
      'Filter by status, repository (owner/repo) or a free-text query over title, branch and repo.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'array', items: { type: 'string', enum: [...STATUSES] } },
        repo: { type: 'string', description: 'owner/repo' },
        query: { type: 'string' },
        unreadOnly: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 200 }
      },
      additionalProperties: false
    },
    presentation: { label: { pending: 'Listing pull requests', completed: 'Listed pull requests' }, icon: { glyph: 'GitPullRequest' } },
    execute: async (input) => {
      const args = record(input);
      const statuses = new Set(stringList(args.status));
      const repo = typeof args.repo === 'string' ? args.repo.trim().toLowerCase() : '';
      const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
      const limit = typeof args.limit === 'number' ? Math.min(200, Math.max(1, Math.floor(args.limit))) : 50;
      const rows = (await deps.methods.listPrs()).map(summary).filter((pr) =>
        (statuses.size === 0 || statuses.has(pr.status))
        && (!repo || pr.ref.toLowerCase().startsWith(`${repo}#`))
        && (!query || `${pr.ref} ${pr.title} ${pr.branch ?? ''}`.toLowerCase().includes(query))
        && (args.unreadOnly !== true || pr.unread)
      );
      return { total: rows.length, prs: rows.slice(0, limit), ...(rows.length > limit ? { truncated: true } : {}) };
    }
  });

  zcc.agents.registerTool({
    name: 'pr_monitor_show',
    description: 'Show one tracked PR in full: every check run with its state, reviewers, merge state and description.',
    parameters: { type: 'object', properties: { pr: prRef }, required: ['pr'], additionalProperties: false },
    presentation: { label: { pending: 'Reading pull request', completed: 'Read pull request' }, icon: { glyph: 'GitPullRequest' } },
    execute: (input) => withPr(input, async (pr) => ({ ok: true, pr: detail(pr) }))
  });

  zcc.agents.registerTool({
    name: 'pr_monitor_sync',
    description:
      'Refresh the board from GitHub now (all repositories, or only the given owner/repo list) and wait for the result. ' +
      'Returns status changes since the last sync. A sync already running is joined, not restarted.',
    parameters: {
      type: 'object',
      properties: { repos: { type: 'array', items: { type: 'string' }, description: 'owner/repo; omit to sync everything.' } },
      additionalProperties: false
    },
    presentation: { label: { pending: 'Syncing pull requests', completed: 'Synced pull requests' }, icon: { glyph: 'RefreshCw' } },
    execute: async (input, ctx: PluginAgentToolContext) => {
      const repos = stringList(record(input).repos);
      let job = deps.startSync(repos.length > 0 ? repos : undefined);
      const deadline = Date.now() + (deps.syncWaitMs ?? DEFAULT_SYNC_WAIT_MS);
      while ((job.state === 'running' || job.state === 'queued') && !ctx.signal.aborted && Date.now() < deadline) {
        await wait(SYNC_STATUS_POLL_INTERVAL_MS, ctx.signal);
        job = deps.syncStatus(job.id);
      }
      if (job.state === 'failed') return { ok: false, error: job.error ?? 'Sync failed.' };
      if (job.state !== 'succeeded') {
        return { ok: true, state: job.state, note: 'Sync is still running; the board updates when it finishes.' };
      }
      return {
        ok: true,
        state: job.state,
        tracked: job.prs?.length ?? 0,
        changes: (job.deltas ?? []).map((delta) => ({
          ref: `${delta.pr.repo}#${delta.pr.number}`, from: delta.oldStatus, to: delta.newStatus
        }))
      };
    }
  });

  zcc.agents.registerTool({
    name: 'pr_monitor_add',
    description: 'Start tracking a PR by URL. Its repository must already be connected and active in PR Monitor settings.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'https://<host>/<owner>/<repo>/pull/<number>' } },
      required: ['url'],
      additionalProperties: false
    },
    presentation: { label: { pending: 'Adding pull request', completed: 'Added pull request' }, icon: { glyph: 'Plus' } },
    execute: async (input) => {
      const url = record(input).url;
      const parsed = typeof url === 'string' ? parsePrUrl(url.trim()) : null;
      if (!parsed) return { ok: false, error: 'Pass a pull request URL like https://github.com/owner/repo/pull/123.' };
      const canonical = `https://${parsed.host}/${parsed.fullName}/pull/${parsed.number}`;
      return mutate(() => deps.methods.pullPr(parsed), canonical);
    }
  });

  zcc.agents.registerTool({
    name: 'pr_monitor_remove',
    description: 'Stop tracking a PR and remove it from the board. Confirm with the user before removing.',
    parameters: { type: 'object', properties: { pr: prRef }, required: ['pr'], additionalProperties: false },
    presentation: { label: { pending: 'Removing pull request', completed: 'Removed pull request' }, icon: { glyph: 'Trash2' } },
    execute: (input) => withPr(input, (pr) => mutate(() => deps.methods.removePr(pr.url)))
  });

  zcc.agents.registerTool({
    name: 'pr_monitor_update',
    description:
      'Change how PR Monitor treats one PR: mark it read or unread, mute or unmute its notifications, ' +
      'favorite it, or assign it to a project (projectId, or null to clear). Pass only the fields to change.',
    parameters: {
      type: 'object',
      properties: {
        pr: prRef,
        read: { type: 'boolean' },
        muted: { type: 'boolean' },
        favorite: { type: 'boolean' },
        projectId: { type: ['string', 'null'] }
      },
      required: ['pr'],
      additionalProperties: false
    },
    presentation: { label: { pending: 'Updating pull request', completed: 'Updated pull request' }, icon: { glyph: 'Pencil' } },
    execute: (input) => withPr(input, async (pr) => {
      const args = record(input);
      const steps: Array<() => Promise<MutationResult>> = [];
      if (typeof args.read === 'boolean') {
        const read = args.read;
        steps.push(() => (read ? deps.methods.markPrAsSeen({ url: pr.url }) : deps.methods.markPrAsUnseen({ url: pr.url })));
      }
      if (typeof args.muted === 'boolean') {
        const muted = args.muted;
        steps.push(() => deps.methods.setPrMuted({ url: pr.url, muted }));
      }
      if (typeof args.favorite === 'boolean') {
        const favorite = args.favorite;
        steps.push(() => deps.methods.setPrFavorite({ url: pr.url, favorite }));
      }
      if (args.projectId === null || typeof args.projectId === 'string') {
        const projectId = typeof args.projectId === 'string' && args.projectId.trim() ? args.projectId.trim() : null;
        steps.push(() => deps.methods.assignProject(pr.url, projectId));
      }
      if (steps.length === 0) return { ok: false, error: 'Pass at least one of read, muted, favorite or projectId.' };
      return mutate(async () => {
        let last: MutationResult = { ok: true };
        for (const step of steps) {
          last = await step();
          if (!last.ok) return last;
        }
        return last;
      }, pr.url);
    })
  });

  zcc.agents.registerTool({
    name: 'pr_monitor_retry',
    description: 'Re-fetch one PR whose last sync failed (it shows a syncError).',
    parameters: { type: 'object', properties: { pr: prRef }, required: ['pr'], additionalProperties: false },
    presentation: { label: { pending: 'Retrying pull request', completed: 'Retried pull request' }, icon: { glyph: 'RotateCw' } },
    execute: (input) => withPr(input, (pr) => mutate(() => deps.methods.retryPr({ url: pr.url }), pr.url))
  });

  zcc.agents.registerTool({
    name: 'pr_monitor_panel',
    desktopOnly: true,
    description:
      'Change what the open PR Monitor board shows the user. action=filter narrows the board to repos and/or a search query ' +
      '(pass neither to clear the filter); action=reveal opens one PR\'s details. Only affects a PR Monitor panel that is open.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['filter', 'reveal'] },
        repos: { type: 'array', items: { type: 'string' }, description: 'filter: owner/repo list.' },
        query: { type: 'string', description: 'filter: search text.' },
        pr: { ...prRef, description: `reveal: ${prRef.description}` }
      },
      required: ['action'],
      additionalProperties: false
    },
    presentation: { label: { pending: 'Updating PR Monitor view', completed: 'Updated PR Monitor view' }, icon: { glyph: 'Eye' } },
    execute: async (input) => {
      const args = record(input);
      if (args.action === 'filter') {
        const action: PrPanelUiAction = {
          action: 'filter',
          repos: stringList(args.repos),
          query: typeof args.query === 'string' ? args.query.trim() : ''
        };
        deps.panelAction(action);
        return { ok: true, sent: action, note: 'Applied if the PR Monitor panel is open.' };
      }
      if (args.action === 'reveal') {
        return withPr(input, async (pr) => {
          deps.panelAction({ action: 'reveal', url: pr.url });
          return { ok: true, sent: { action: 'reveal', ref: `${pr.repo}#${pr.number}` }, note: 'Applied if the PR Monitor panel is open.' };
        });
      }
      return { ok: false, error: 'action must be filter or reveal.' };
    }
  });
}
