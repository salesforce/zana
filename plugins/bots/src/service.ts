import type { PluginSdkThreadSummary, ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import {
  BotValidationError,
  MAX_ACTIVE_JOBS_PER_BOT,
  inboundDelivery,
  jobDelivery,
  jobThreadInstructions,
  mainThreadInstructions,
  replyDelivery,
  routineDelivery,
  validatePrompt,
  type Delivery,
  type Bot,
  type BotInput,
  type BotRoutine,
  type RoutineInput
} from './model.js';
import { TrustLedger } from './policy.js';
import { BotStore, findRoutine, type BotJob } from './store.js';

export const BOTS_CHANGED_CHANNEL = 'bots:changed';
const ACTIVE_STATUSES = new Set(['active', 'starting', 'stopping']);
/** Routine minutes re-checked after a late or skipped tick (or a restart). */
export const TICK_CATCH_UP_MINUTES = 10;
const LAST_TICK_KEY = 'routines:lastTickAt';

export type BotsApi = Pick<ZccPluginApi, 'sdk' | 'realtime' | 'log' | 'pluginId'>;

/** Ask the human to approve an agent-originated action; resolves true only on approval. */
export type Approver = (request: { action: 'send' | 'manage'; bot: Bot; summary: string }) => Promise<boolean>;

/**
 * Who is asking. `user` is a human surface (Bots panel, a terminal `zcc bots`).
 * `agent` is a thread turn: a tool call, or `zcc bots` run from a thread shell
 * (which has no approver, so it only uses grants a human already gave).
 */
export type Sender = { kind: 'user'; via: string } | { kind: 'agent'; threadId: string; approve?: Approver };

export type ThreadRole = { kind: 'main'; bot: Bot } | { kind: 'job'; bot: Bot } | { kind: 'thread' };

export interface BotJobView extends BotJob {
  status: string;
  archived: boolean;
}

export interface BotView extends Bot {
  mainThreadStatus: string | null;
  activeJobs: number;
}

/** Minute key in host local time; routines fire at most once per matching minute. */
export function minuteKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}T${date.getHours()}:${date.getMinutes()}`;
}

export class BotService {
  /** Per-bot chain so two concurrent deliveries cannot both create a main thread. */
  private readonly deliveries = new Map<string, Promise<unknown>>();
  readonly trust: TrustLedger;

  constructor(
    private readonly zcc: BotsApi,
    readonly store: BotStore,
    private readonly cronMatches: (expr: string, date: Date) => boolean,
    private readonly now: () => number = Date.now,
    private readonly kv: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> } = memoryKv()
  ) {
    this.trust = new TrustLedger(now);
  }

  changed(botId?: string): void {
    this.zcc.realtime.publish(BOTS_CHANGED_CHANNEL, botId ? { botId } : {});
  }

  /**
   * Instructions for a thread that belongs to a bot, or null for any other
   * thread. The spawn metadata covers the first turn, which starts before the
   * new thread id is recorded on the bot or its job list.
   */
  instructionsFor(threadId: string | undefined, metadata: Record<string, unknown> = {}): string | null {
    const bots = this.store.snapshot();
    const tagged = typeof metadata.botId === 'string' ? bots.find((bot) => bot.id === metadata.botId) : undefined;
    if (tagged && metadata.botRole === 'main') return mainThreadInstructions(tagged);
    if (tagged && metadata.botRole === 'job') return jobThreadInstructions(tagged);
    if (!threadId) return null;
    const main = bots.find((bot) => bot.mainThreadId === threadId);
    if (main) return mainThreadInstructions(main);
    const job = this.store.jobsSnapshot().find((row) => row.threadId === threadId);
    const owner = job ? bots.find((bot) => bot.id === job.botId) : undefined;
    return owner ? jobThreadInstructions(owner) : null;
  }

  /** The bot whose main thread is `threadId`. */
  botForMainThread(threadId: string): Bot | undefined {
    return this.store.snapshot().find((bot) => bot.mainThreadId === threadId);
  }

  /** Whether `threadId` is a bot's main thread, one of its jobs, or any other thread. */
  roleOf(threadId: string): ThreadRole {
    const main = this.botForMainThread(threadId);
    if (main) return { kind: 'main', bot: main };
    const job = this.store.jobsSnapshot().find((row) => row.threadId === threadId);
    const owner = job ? this.store.snapshot().find((bot) => bot.id === job.botId) : undefined;
    return owner ? { kind: 'job', bot: owner } : { kind: 'thread' };
  }

  async create(input: BotInput): Promise<Bot> {
    const projectId = typeof input.projectId === 'string' && input.projectId.trim()
      ? input.projectId.trim()
      : await this.defaultProjectId();
    await this.checkTargets({ ...input, projectId });
    const bot = await this.store.create({ ...input, projectId });
    this.changed(bot.id);
    return bot;
  }

  async update(ref: string, input: BotInput): Promise<Bot> {
    await this.checkTargets(input);
    const bot = await this.store.update(ref, input);
    this.changed(bot.id);
    return bot;
  }

  /** Projects and providers must be registered on this host: they decide where a full-permission bot runs. */
  private async checkTargets(input: BotInput): Promise<void> {
    const projectId = typeof input.projectId === 'string' ? input.projectId.trim() : '';
    if (projectId) {
      const projects = await this.zcc.sdk.projects.list();
      if (!projects.some((row) => row.id === projectId)) throw new BotValidationError(`unknown project "${projectId}"`);
    }
    const providerId = typeof input.providerId === 'string' ? input.providerId.trim() : '';
    if (providerId) {
      const providers = await this.zcc.sdk.providers.list();
      if (!providers.some((row) => row.id === providerId)) throw new BotValidationError(`unknown provider "${providerId}"`);
    }
  }

  async remove(ref: string, options: { archiveThreads?: boolean } = {}): Promise<Bot> {
    const bot = await this.requireBot(ref);
    const jobs = await this.store.jobs(bot.id);
    await this.store.remove(bot.id);
    if (options.archiveThreads) {
      for (const threadId of [bot.mainThreadId, ...jobs.map((job) => job.threadId)]) {
        if (!threadId) continue;
        await this.zcc.sdk.threads.archive({ threadId }).catch((error: unknown) => {
          this.zcc.log.warn(`could not archive ${threadId}: ${errorMessage(error)}`);
        });
      }
    }
    this.changed(bot.id);
    return bot;
  }

  async requireBot(ref: string): Promise<Bot> {
    const bot = await this.store.get(ref);
    if (!bot) throw new BotValidationError(`unknown bot "${ref}"`);
    return bot;
  }

  async view(bot: Bot): Promise<BotView> {
    const main = bot.mainThreadId ? await this.peek(bot.mainThreadId) : null;
    const jobs = await this.jobs(bot.id);
    return {
      ...bot,
      mainThreadStatus: main === 'unknown' ? 'unknown' : main ? main.status : null,
      activeJobs: jobs.filter((job) => !job.archived && ACTIVE_STATUSES.has(job.status)).length
    };
  }

  async listViews(): Promise<BotView[]> {
    const bots = await this.store.list();
    return Promise.all(bots.map((bot) => this.view(bot)));
  }

  async jobs(botId: string): Promise<BotJobView[]> {
    const jobs = await this.store.jobs(botId);
    const views = await Promise.all(jobs.map(async (job) => {
      const thread = await this.peek(job.threadId);
      if (thread === 'unknown') return { ...job, status: 'unknown', archived: false };
      if (!thread) return null;
      return { ...job, status: thread.status, archived: thread.archivedAt != null };
    }));
    return views.filter((job): job is BotJobView => job !== null).sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * Deliver a message to the bot's single main thread, creating (or recreating,
   * when the old one was deleted) that thread on first contact. Messages to a
   * busy bot queue behind its current turn.
   */
  async deliver(ref: string, delivery: Delivery): Promise<{ bot: Bot; threadId: string; created: boolean }> {
    const text = { ...delivery, prompt: validatePrompt(delivery.prompt, 'message') };
    const target = await this.requireBot(ref);
    const previous = this.deliveries.get(target.id) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.deliverNow(target.id, text));
    this.deliveries.set(target.id, run);
    try {
      return await run;
    } finally {
      if (this.deliveries.get(target.id) === run) this.deliveries.delete(target.id);
    }
  }

  private async deliverNow(botId: string, delivery: Delivery): Promise<{ bot: Bot; threadId: string; created: boolean }> {
    const bot = await this.requireBot(botId);
    const existing = bot.mainThreadId ? await this.thread(bot.mainThreadId) : null;
    if (existing) {
      if (existing.archivedAt != null) await this.zcc.sdk.threads.unarchive({ threadId: existing.id });
      await this.zcc.sdk.threads.send({ threadId: existing.id, ...this.wire(delivery), mode: 'queue-if-active' });
      return { bot, threadId: existing.id, created: false };
    }
    const spawned = await this.zcc.sdk.threads.spawn({
      projectId: bot.projectId,
      ...this.wire(delivery),
      title: bot.name,
      permissionMode: 'full',
      visibility: 'visible',
      ...(bot.providerId ? { providerId: bot.providerId } : { harness: 'project-default' as const }),
      ...(bot.model ? { model: bot.model } : {}),
      pluginMetadata: { botId: bot.id, botRole: 'main' }
    });
    const updated = await this.store.setMainThread(bot.id, spawned.id);
    this.changed(bot.id);
    return { bot: updated, threadId: spawned.id, created: true };
  }

  /**
   * Message a bot. Humans always get through. Agent turns are rate limited and
   * need a human approval (remembered for a while per thread and bot) because
   * the bot runs with full permissions; background jobs cannot message bots.
   */
  async send(ref: string, message: string, from: Sender) {
    const bot = await this.requireBot(ref);
    const text = validatePrompt(message, 'message');
    if (from.kind === 'user') return this.deliver(bot.id, inboundDelivery(text, { kind: 'user', via: from.via }));
    const role = this.roleOf(from.threadId);
    if (role.kind === 'job') throw new BotValidationError('background jobs cannot message bots; put it in your final answer instead');
    if (role.kind === 'main' && role.bot.id === bot.id) {
      throw new BotValidationError('a bot cannot message itself; just continue in this thread');
    }
    if (!this.trust.takeDelivery(from.threadId, bot.id)) {
      throw new BotValidationError(`too many messages to ${bot.name} from this thread; try again later`);
    }
    await this.authorize(from, 'send', bot, `Let this thread message ${bot.name}. The bot runs with full permissions in its project.`);
    const source = role.kind === 'main'
      ? { kind: 'bot' as const, bot: role.bot, threadId: from.threadId }
      : { kind: 'thread' as const, threadId: from.threadId, title: await this.titleOf(from.threadId) };
    const result = await this.deliver(bot.id, inboundDelivery(text, source));
    this.trust.allowReply(bot.id, from.threadId);
    return result;
  }

  private async authorize(from: Extract<Sender, { kind: 'agent' }>, action: 'send' | 'manage', bot: Bot, summary: string): Promise<void> {
    if (this.trust.hasGrant(from.threadId, bot.id, action)) return;
    const approved = from.approve ? await from.approve({ action, bot, summary }) : false;
    if (!approved) {
      throw new BotValidationError(
        `not approved: a person must allow this thread to ${action === 'send' ? 'message' : 'change'} ${bot.name}. ` +
        'Ask them to approve the request, or to do it from the Bots panel.'
      );
    }
    this.trust.grant(from.threadId, bot.id, action);
  }

  /**
   * Which bot a routine call may touch. Humans: any. A bot main thread: only
   * itself. Background jobs: none. Other threads: read freely, change with approval.
   */
  async routineTarget(from: Sender, ref: string | undefined, mutating: boolean): Promise<Bot> {
    if (from.kind === 'user') return this.requireBot(ref ?? '');
    const role = this.roleOf(from.threadId);
    if (role.kind === 'job') throw new BotValidationError('background jobs cannot manage routines');
    if (role.kind === 'main') {
      if (ref && (await this.store.get(ref))?.id !== role.bot.id) {
        throw new BotValidationError('a bot can only manage its own routines');
      }
      return role.bot;
    }
    if (!ref) throw new BotValidationError('bot is required outside a bot main thread');
    const bot = await this.requireBot(ref);
    if (mutating) await this.authorizeManage(from, bot);
    return bot;
  }

  /** Changing a bot's definition or routines from an agent turn needs a human approval. */
  async authorizeManage(from: Sender, bot: Bot): Promise<void> {
    if (from.kind === 'user') return;
    const role = this.roleOf(from.threadId);
    if (role.kind === 'job') throw new BotValidationError('background jobs cannot change bots');
    if (role.kind === 'main' && role.bot.id === bot.id) return;
    if (role.kind === 'main') throw new BotValidationError('a bot can only change itself');
    await this.authorize(from, 'manage', bot, `Let this thread change ${bot.name}: its personality, settings and routines. The bot runs with full permissions.`);
  }

  /** A bot answering a thread that messaged it recently. */
  async reply(fromThreadId: string, targetThreadId: string, message: string): Promise<{ threadId: string }> {
    const bot = this.botForMainThread(fromThreadId);
    if (!bot) throw new BotValidationError('bot_reply can only be called from a bot main thread');
    const target = targetThreadId.trim();
    if (!target) throw new BotValidationError('threadId is required');
    if (target === fromThreadId) throw new BotValidationError('a bot cannot reply to itself');
    const text = validatePrompt(message, 'message');
    if (!this.trust.takeReply(bot.id, target)) {
      throw new BotValidationError('you can only reply to a thread that messaged you in the last day (a few replies per message)');
    }
    if (!this.trust.takeDelivery(fromThreadId, target)) throw new BotValidationError('too many replies to that thread; try again later');
    const thread = await this.thread(target);
    if (!thread || thread.deletedAt) throw new BotValidationError(`unknown thread "${target}"`);
    if (thread.archivedAt != null) throw new BotValidationError('that thread is archived');
    await this.zcc.sdk.threads.send({ threadId: target, ...this.wire(replyDelivery(bot, text)), mode: 'queue-if-active' });
    return { threadId: target };
  }

  /**
   * Start a hidden background job whose final answer flows back into the bot's
   * main thread. Serialized per bot so parallel calls cannot overshoot the cap.
   */
  async startJob(fromThreadId: string, input: { prompt?: unknown; title?: unknown }): Promise<{ threadId: string }> {
    const key = `jobs:${this.botForMainThread(fromThreadId)?.id ?? fromThreadId}`;
    const previous = this.deliveries.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.startJobNow(fromThreadId, input));
    this.deliveries.set(key, run);
    try {
      return await run;
    } finally {
      if (this.deliveries.get(key) === run) this.deliveries.delete(key);
    }
  }

  private async startJobNow(fromThreadId: string, input: { prompt?: unknown; title?: unknown }): Promise<{ threadId: string }> {
    const bot = this.botForMainThread(fromThreadId);
    if (!bot || !bot.mainThreadId) throw new BotValidationError('bot_job_start can only be called from a bot main thread');
    const prompt = validatePrompt(input.prompt);
    // A job whose status could not be read counts as running, so a flaky lookup cannot lift the cap.
    const active = (await this.jobs(bot.id)).filter((job) => !job.archived && (ACTIVE_STATUSES.has(job.status) || job.status === 'unknown'));
    if (active.length >= MAX_ACTIVE_JOBS_PER_BOT) {
      throw new BotValidationError(`${bot.name} already has ${active.length} running jobs (max ${MAX_ACTIVE_JOBS_PER_BOT}); wait for one to finish`);
    }
    if (!this.trust.takeDelivery(bot.mainThreadId, 'jobs')) {
      throw new BotValidationError(`${bot.name} started too many jobs this hour; do the rest in this thread or wait`);
    }
    const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 80) : prompt.split('\n')[0]!.slice(0, 80);
    const spawned = await this.zcc.sdk.threads.spawn({
      projectId: bot.projectId,
      ...this.wire(jobDelivery(bot, prompt)),
      title: `${bot.name} · ${title}`,
      parentThreadId: bot.mainThreadId,
      permissionMode: 'full',
      visibility: 'hidden',
      ...(bot.providerId ? { providerId: bot.providerId } : { harness: 'project-default' as const }),
      ...(bot.model ? { model: bot.model } : {}),
      pluginMetadata: { botId: bot.id, botRole: 'job' }
    });
    await this.store.addJob({ threadId: spawned.id, botId: bot.id, title, startedAt: this.now() });
    this.changed(bot.id);
    return { threadId: spawned.id };
  }

  async addRoutine(ref: string, input: RoutineInput) {
    const result = await this.store.addRoutine(ref, input);
    this.changed(result.bot.id);
    return result;
  }

  async updateRoutine(ref: string, routineRef: string, input: RoutineInput) {
    const bot = await this.store.updateRoutine(ref, routineRef, input);
    this.changed(bot.id);
    return bot;
  }

  async removeRoutine(ref: string, routineRef: string) {
    const bot = await this.store.removeRoutine(ref, routineRef);
    this.changed(bot.id);
    return bot;
  }

  async runRoutine(ref: string, routineRef: string): Promise<{ threadId: string }> {
    const bot = await this.requireBot(ref);
    const routine = findRoutine(bot, routineRef);
    const result = await this.fire(bot.id, routine.id, this.now(), true);
    if (!result) throw new BotValidationError(`routine ${routine.name} was removed`);
    return result;
  }

  /**
   * Deliver one routine occurrence. The routine is re-read first, so one that
   * was disabled or removed meanwhile does not fire; the run is recorded only
   * after the bot got it, so a failed delivery is retried on the next tick.
   */
  private async fire(botId: string, routineId: string, at: number, force = false): Promise<{ threadId: string } | null> {
    const bot = await this.store.get(botId);
    const routine = bot?.routines.find((row) => row.id === routineId);
    if (!bot || !routine || (!force && (!routine.enabled || this.ranInMinute(routine, at)))) return null;
    const result = await this.deliver(bot.id, routineDelivery(routine));
    await this.store.markRoutineRun(bot.id, routine.id, at);
    this.changed(bot.id);
    return { threadId: result.threadId };
  }

  private ranInMinute(routine: BotRoutine, at: number): boolean {
    return routine.lastRunAt !== undefined && minuteKey(routine.lastRunAt) === minuteKey(at);
  }

  /**
   * Minute tick. The host drops a tick while the previous one still runs and its
   * interval drifts, so every minute since the last tick (bounded) is checked.
   * Bots run in parallel; one bot's routines run in order.
   */
  async tick(at: number = this.now()): Promise<number> {
    const nowMinute = Math.floor(at / 60_000);
    const stored = Number(await this.kv.get(LAST_TICK_KEY));
    const lastMinute = Number.isFinite(stored) && stored > 0 ? Math.floor(stored / 60_000) : nowMinute - 1;
    const minutes: number[] = [];
    for (let minute = Math.max(lastMinute + 1, nowMinute - TICK_CATCH_UP_MINUTES + 1); minute <= nowMinute; minute += 1) minutes.push(minute);
    await this.kv.set(LAST_TICK_KEY, at);
    const counts = await Promise.all((await this.store.list()).map(async (bot) => {
      let fired = 0;
      for (const routine of bot.routines) {
        if (!routine.enabled) continue;
        const due = minutes.find((minute) => this.cronMatches(routine.cron, new Date(minute * 60_000)) && !this.ranInMinute(routine, minute * 60_000));
        if (due === undefined) continue;
        try {
          if (await this.fire(bot.id, routine.id, due === nowMinute ? at : due * 60_000)) fired += 1;
        } catch (error) {
          this.zcc.log.warn(`routine ${bot.name}/${routine.name} failed: ${errorMessage(error)}`);
        }
      }
      return fired;
    }));
    return counts.reduce((sum, count) => sum + count, 0);
  }

  /**
   * The host emits thread.deleted when a thread is archived (archive is its
   * delete), and the row stays. An archived main thread is unarchived on the
   * next message; only a thread the host no longer knows is forgotten.
   */
  async forgetThread(threadId: string): Promise<void> {
    if (await this.thread(threadId)) return;
    if (await this.store.removeJob(threadId)) this.changed();
    const bot = this.botForMainThread(threadId);
    if (bot) {
      await this.store.setMainThread(bot.id, undefined);
      this.changed(bot.id);
    }
  }

  /** The host returns null only for an unknown id; transport errors propagate so callers never mistake them for "gone". */
  private async thread(threadId: string): Promise<PluginSdkThreadSummary | null> {
    return this.zcc.sdk.threads.get({ threadId });
  }

  /** Older hosts drop `source` / `agentContext`: keep the header in the prompt there. */
  private wire(delivery: Delivery): Delivery | { prompt: string } {
    const threads = this.zcc.sdk.threads;
    return 'messageSources' in threads && threads.messageSources ? delivery : { prompt: `${delivery.agentContext}\n${delivery.prompt}` };
  }

  /** A label for the asking thread; a failed lookup only loses the title. */
  private async titleOf(threadId: string): Promise<string | null> {
    const thread = await this.peek(threadId);
    return thread && thread !== 'unknown' ? thread.title || thread.titleFallback || null : null;
  }

  /** For read-only views: a failed lookup shows as "unknown" rather than failing the whole list. */
  private async peek(threadId: string): Promise<PluginSdkThreadSummary | null | 'unknown'> {
    try {
      return await this.thread(threadId);
    } catch {
      return 'unknown';
    }
  }

  private async defaultProjectId(): Promise<string> {
    const projects = await this.zcc.sdk.projects.list();
    const project = projects.find((row) => row.quickAgent) ?? projects[0];
    if (!project) throw new BotValidationError('no project is registered; add a project or pass projectId');
    return project.id;
  }
}

function memoryKv() {
  const map = new Map<string, unknown>();
  return { get: async (key: string) => map.get(key), set: async (key: string, value: unknown) => void map.set(key, value) };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
