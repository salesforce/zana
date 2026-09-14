import { ControlError } from './errors.js';
import type { ProductHttpClient } from './http.js';
import { appendJournalIds, liveTitle } from './tags.js';
import type { LaunchContext } from './threads.js';
import type { CliAgentLaunchSpec, CliAgentRecord, CliAgentWaitUntil } from './types.js';

function isTagged(ctx: LaunchContext): boolean {
  return ctx.tagged !== false;
}

export function rejectIsolatedCliAgent(isolated: boolean): void {
  if (!isolated) return;
  throw new ControlError(
    'ISOLATED_CLI_AGENT',
    'CLI Agent cannot run on an isolated (no-Electron) stack until host-rpc harness.start exists. Parallel CLI Agent = many sessions on one desktop.'
  );
}

export function assertRoleXorModel(spec: Pick<CliAgentLaunchSpec, 'harnessRouting'>): void {
  const adapters = spec.harnessRouting?.byAdapter;
  if (!adapters) return;
  for (const intent of Object.values(adapters)) {
    if (!intent?.roleTargetId) continue;
    if (intent.modelTargetId || intent.modelLevel || intent.compatibility?.model) {
      throw new ControlError(
        'ROLE_XOR_MODEL',
        'native role and catalog model are mutually exclusive (nativeRolePinsModel)'
      );
    }
  }
}

export class CliAgentHandle {
  constructor(
    readonly http: ProductHttpClient,
    readonly id: string,
    private record: CliAgentRecord
  ) {}

  snapshot(): CliAgentRecord {
    return this.record;
  }

  get status(): string {
    return this.record.status;
  }

  async refresh(): Promise<CliAgentRecord> {
    const shown = await this.http.request<{ session?: CliAgentRecord; agent?: CliAgentRecord }>(
      'GET',
      `/api/v1/cli-agents/${encodeURIComponent(this.id)}`
    );
    this.record = shown.session ?? shown.agent ?? this.record;
    return this.record;
  }

  async wait(opts: { until?: CliAgentWaitUntil; timeoutMs?: number } = {}): Promise<CliAgentRecord> {
    const until = opts.until ?? 'idle';
    const deadline = this.http.nowMs() + (opts.timeoutMs ?? 120_000);
    while (this.http.nowMs() < deadline) {
      const row = await this.refresh();
      const status = row.status;
      if (until === 'working' && status === 'working') return row;
      if (until === 'idle' && (status === 'idle' || status === 'done' || status === 'exited')) return row;
      if (until === 'done' && (status === 'done' || status === 'exited')) return row;
      if (until === 'exited' && status === 'exited') return row;
      await this.http.sleep(250);
    }
    throw new ControlError('TIMEOUT', `timed out waiting for CLI agent ${this.id}`, {
      details: this.record
    });
  }

  async reply(text: string): Promise<void> {
    await this.http.request(
      'POST',
      `/api/v1/cli-agents/${encodeURIComponent(this.id)}/reply`,
      { body: { text } }
    );
  }

  async stop(): Promise<void> {
    await this.http.request(
      'POST',
      `/api/v1/cli-agents/${encodeURIComponent(this.id)}/stop`,
      { body: {} }
    );
  }
}

export async function launchCliAgent(
  http: ProductHttpClient,
  spec: Omit<CliAgentLaunchSpec, 'surface'>,
  ctx: LaunchContext
): Promise<CliAgentHandle> {
  assertRoleXorModel(spec);
  const tagged = isTagged(ctx);
  const created = await http.request<{ value?: CliAgentRecord; session?: CliAgentRecord; agent?: CliAgentRecord }>(
    'POST',
    '/api/v1/cli-agents',
    {
      body: {
        projectId: spec.projectId,
        profile: spec.profile,
        prompt: spec.prompt,
        personaId: spec.personaId,
        extraArgs: spec.extraArgs,
        harnessRouting: spec.harnessRouting,
        worktree: spec.worktree,
        environment: spec.executionEnvironment,
        isolateScratch: spec.isolateScratch,
        title: tagged ? liveTitle(ctx.runId, spec.title) : spec.title,
        cols: 80,
        rows: 24
      }
    }
  );
  const row = created.value ?? created.session ?? created.agent;
  if (!row?.id) throw new ControlError('HTTP_ERROR', 'cli-agent launch did not return an id');
  if (tagged) {
    appendJournalIds(ctx.dataDir, ctx.runId, { cliAgentIds: [row.id], projectId: spec.projectId });
  }
  return new CliAgentHandle(http, row.id, row);
}
