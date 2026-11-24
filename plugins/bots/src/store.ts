import type { PluginKvStorage } from '@zana-ai/zcc-plugin-sdk/server';
import {
  BotValidationError,
  MAX_BOTS,
  MAX_ROUTINE_RESULT_LENGTH,
  MAX_ROUTINES_PER_BOT,
  findBot,
  newBot,
  newRoutine,
  patchBot,
  patchRoutine,
  slugify,
  type Bot,
  type BotInput,
  type BotPatch,
  type BotRoutine,
  type RoutineRun,
  type RoutineInput
} from './model.js';

const BOTS_KEY = 'bots:v1';
const JOBS_KEY = 'jobs:v1';
/** Retention cap for finished-job records kept for the Jobs tab. */
export const MAX_JOB_RECORDS_PER_BOT = 50;

export interface BotJob {
  threadId: string;
  botId: string;
  title: string;
  startedAt: number;
  /** Set on the hidden thread of an AI routine run; its result is posted to the main chat by the plugin. */
  routineId?: string;
  /** The run timestamp recorded on the routine, so the result updates that run. */
  runAt?: number;
}

/**
 * KV-backed bot registry. Every read-modify-write runs through one in-process
 * promise chain so concurrent RPC, tool, and routine calls cannot interleave
 * and lose an update. Callers get defensive copies.
 */
export class BotStore {
  private chain: Promise<unknown> = Promise.resolve();
  private cache: Bot[] | null = null;
  private jobsCache: BotJob[] | null = null;

  constructor(
    private readonly kv: PluginKvStorage,
    private readonly ids: () => string = () => Math.random().toString(36).slice(2, 10),
    private readonly now: () => number = Date.now
  ) {}

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work, work);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async loadBots(): Promise<Bot[]> {
    if (this.cache) return this.cache;
    const raw = await this.kv.get<unknown>(BOTS_KEY);
    this.cache = Array.isArray(raw)
      ? raw.filter(isBotRecord).map(({ avatar: _legacyAvatar, ...bot }) => bot)
      : [];
    return this.cache;
  }

  private async loadJobs(): Promise<BotJob[]> {
    if (this.jobsCache) return this.jobsCache;
    const raw = await this.kv.get<unknown>(JOBS_KEY);
    this.jobsCache = Array.isArray(raw) ? (raw.filter(isJobRecord) as BotJob[]) : [];
    return this.jobsCache;
  }

  private async saveBots(bots: Bot[]): Promise<void> {
    await this.kv.set(BOTS_KEY, bots);
    this.cache = bots;
  }

  private async saveJobs(jobs: BotJob[]): Promise<void> {
    await this.kv.set(JOBS_KEY, jobs);
    this.jobsCache = jobs;
  }

  async list(): Promise<Bot[]> {
    return this.serialize(async () => structuredClone(await this.loadBots()));
  }

  async get(ref: string): Promise<Bot | undefined> {
    return this.serialize(async () => {
      const bot = findBot(await this.loadBots(), ref);
      return bot ? structuredClone(bot) : undefined;
    });
  }

  /** Synchronous snapshot for instruction providers; empty until first load. */
  snapshot(): readonly Bot[] {
    return this.cache ?? [];
  }

  jobsSnapshot(): readonly BotJob[] {
    return this.jobsCache ?? [];
  }

  async warm(): Promise<void> {
    await this.serialize(async () => {
      await this.loadBots();
      await this.loadJobs();
    });
  }

  async create(input: BotInput): Promise<Bot> {
    return this.serialize(async () => {
      const bots = await this.loadBots();
      if (bots.length >= MAX_BOTS) throw new BotValidationError(`at most ${MAX_BOTS} bots are allowed`);
      const draft = newBot(input, 'pending', this.now());
      const slug = slugify(draft.name);
      // Also refuse a slug that is another bot's id (kept from its original name), or refs would resolve to that bot.
      if (bots.some((bot) => slugify(bot.name) === slug || bot.id === slug)) {
        throw new BotValidationError(`a bot named "${draft.name}" already exists`);
      }
      let id = slug;
      while (bots.some((bot) => bot.id === id)) id = `${slug}-${this.ids()}`;
      const bot = { ...draft, id };
      await this.saveBots([...bots, bot]);
      return structuredClone(bot);
    });
  }

  private async mutate(ref: string, change: (bot: Bot) => Bot): Promise<Bot> {
    return this.serialize(async () => {
      const bots = await this.loadBots();
      const current = findBot(bots, ref);
      if (!current) throw new BotValidationError(`unknown bot "${ref}"`);
      const next = change(structuredClone(current));
      const slug = slugify(next.name);
      if (slug !== slugify(current.name)
        && bots.some((bot) => bot.id !== current.id && (slugify(bot.name) === slug || bot.id === slug))) {
        throw new BotValidationError(`a bot named "${next.name}" already exists`);
      }
      await this.saveBots(bots.map((bot) => (bot.id === current.id ? next : bot)));
      return structuredClone(next);
    });
  }

  update(ref: string, input: BotPatch): Promise<Bot> {
    return this.mutate(ref, (bot) => patchBot(bot, input, this.now()));
  }

  setMainThread(ref: string, threadId: string): Promise<Bot> {
    return this.mutate(ref, bot => ({ ...bot, mainThreadId: threadId, updatedAt: this.now() }));
  }

  clearMainThread(ref: string, deletedId: string): Promise<Bot> {
    return this.mutate(ref, bot => {
      if (bot.mainThreadId !== deletedId) return bot;
      delete bot.mainThreadId;
      return { ...bot, updatedAt: this.now() };
    });
  }

  async remove(ref: string): Promise<Bot> {
    return this.serialize(async () => {
      const bots = await this.loadBots();
      const bot = findBot(bots, ref);
      if (!bot) throw new BotValidationError(`unknown bot "${ref}"`);
      // Jobs first: if the second write fails the bot still exists and can be deleted again.
      await this.saveJobs((await this.loadJobs()).filter((job) => job.botId !== bot.id));
      await this.saveBots(bots.filter((row) => row.id !== bot.id));
      return structuredClone(bot);
    });
  }

  addRoutine(ref: string, input: RoutineInput): Promise<{ bot: Bot; routine: BotRoutine }> {
    let created: BotRoutine | undefined;
    return this.mutate(ref, (bot) => {
      if (bot.routines.length >= MAX_ROUTINES_PER_BOT) {
        throw new BotValidationError(`a bot can have at most ${MAX_ROUTINES_PER_BOT} routines`);
      }
      const base = slugify(String(input.name ?? '')) || 'routine';
      if (bot.routines.some((routine) => slugify(routine.name) === base || routine.id === base)) {
        throw new BotValidationError(`${bot.name} already has a routine named "${String(input.name).trim()}"`);
      }
      let id = base;
      while (bot.routines.some((routine) => routine.id === id)) id = `${base}-${this.ids()}`;
      created = newRoutine(input, id);
      return { ...bot, routines: [...bot.routines, created], updatedAt: this.now() };
    }).then((bot) => ({ bot, routine: created! }));
  }

  updateRoutine(ref: string, routineRef: string, input: RoutineInput): Promise<Bot> {
    return this.mutate(ref, (bot) => {
      const routine = findRoutine(bot, routineRef);
      return {
        ...bot,
        routines: bot.routines.map((row) => (row.id === routine.id ? patchRoutine(row, input) : row)),
        updatedAt: this.now()
      };
    });
  }

  removeRoutine(ref: string, routineRef: string): Promise<Bot> {
    return this.mutate(ref, (bot) => {
      const routine = findRoutine(bot, routineRef);
      return { ...bot, routines: bot.routines.filter((row) => row.id !== routine.id), updatedAt: this.now() };
    });
  }

  markRoutineRun(botId: string, routineId: string, at: number, status: RoutineRun['status'] = 'sent',
    details: { error?: string; prices?: Record<string, number>; threadId?: string } = {}): Promise<Bot> {
    const run: RoutineRun = {
      at, status, ...(details.error ? { error: details.error.slice(0, 200) } : {}), ...(details.threadId ? { threadId: details.threadId } : {})
    };
    return this.mutate(botId, (bot) => ({
      ...bot,
      routines: bot.routines.map(row => row.id !== routineId ? row : {
        ...row, lastRunAt: at, runs: [run, ...(row.runs ?? [])].slice(0, 5),
        ...(details.prices ? { lastPrices: details.prices } : {})
      })
    }));
  }

  /**
   * Settle the run of thread `threadId` (started at `at`): update its status, or
   * record it when the run was pruned, and keep the posted result for the next run.
   */
  finishRoutineRun(botId: string, routineId: string, threadId: string, at: number, status: RoutineRun['status'],
    details: { error?: string; result?: string } = {}): Promise<Bot> {
    const run: RoutineRun = { at, status, threadId, ...(details.error ? { error: details.error.slice(0, 200) } : {}) };
    return this.mutate(botId, (bot) => ({
      ...bot,
      routines: bot.routines.map(row => {
        if (row.id !== routineId) return row;
        const runs = row.runs ?? [];
        const known = runs.some(r => r.threadId === threadId);
        return {
          ...row,
          runs: known ? runs.map(r => (r.threadId === threadId ? run : r)) : [run, ...runs].slice(0, 5),
          ...(details.result !== undefined ? { lastResult: details.result.slice(0, MAX_ROUTINE_RESULT_LENGTH) } : {})
        };
      })
    }));
  }

  async jobs(botId: string): Promise<BotJob[]> {
    return this.serialize(async () => structuredClone((await this.loadJobs()).filter((job) => job.botId === botId)));
  }

  async addJob(job: BotJob): Promise<void> {
    await this.serialize(async () => {
      const jobs = [...(await this.loadJobs()), job];
      // Retention cap: keep the newest records per bot.
      const own = jobs.filter((row) => row.botId === job.botId).sort((a, b) => b.startedAt - a.startedAt);
      const dropped = new Set(own.slice(MAX_JOB_RECORDS_PER_BOT).map((row) => row.threadId));
      await this.saveJobs(jobs.filter((row) => !dropped.has(row.threadId)));
    });
  }

  async removeJob(threadId: string): Promise<boolean> {
    return this.serialize(async () => {
      const jobs = await this.loadJobs();
      if (!jobs.some((job) => job.threadId === threadId)) return false;
      await this.saveJobs(jobs.filter((job) => job.threadId !== threadId));
      return true;
    });
  }
}

export function findRoutine(bot: Bot, ref: string): BotRoutine {
  const needle = ref.trim();
  const slug = slugify(needle);
  const routine = bot.routines.find((row) => row.id === needle)
    ?? bot.routines.find((row) => row.name.toLowerCase() === needle.toLowerCase())
    ?? (slug ? bot.routines.find((row) => slugify(row.name) === slug) : undefined);
  if (!routine) throw new BotValidationError(`unknown routine "${ref}" on bot ${bot.name}`);
  return routine;
}

function isBotRecord(value: unknown): value is Bot & { avatar?: unknown } {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && typeof row.name === 'string' && typeof row.projectId === 'string'
    && Array.isArray(row.routines);
}

function isJobRecord(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.threadId === 'string' && typeof row.botId === 'string' && typeof row.startedAt === 'number'
    && (row.routineId === undefined || typeof row.routineId === 'string');
}
