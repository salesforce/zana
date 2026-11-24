/**
 * Bot domain model: a bot is one persistent visible thread (its "main thread")
 * plus a personality, scheduled routines, and hidden background job threads.
 * Everything here is pure so it can be validated without a host.
 */

export const ROUTINE_KINDS = { agent: 'AI prompt', price: 'Price check', reminder: 'Fixed message' } as const;
export type RoutineKind = keyof typeof ROUTINE_KINDS;

export interface RoutineRun {
  at: number;
  /**
   * posted: a result was posted to the main chat. quiet: an AI routine found
   * nothing new, so nothing was posted. running: an AI routine is still working.
   * sent: legacy, the prompt was delivered into the main thread.
   */
  status: 'posted' | 'quiet' | 'running' | 'sent' | 'failed';
  error?: string;
  /** The hidden thread of a quiet AI run; identifies the run when it settles. */
  threadId?: string;
}

/** An AI routine answers exactly this when nothing changed; the plugin then posts nothing. */
export const NO_CHANGE = 'NO_CHANGE';
/** Cap on the last posted result kept per routine and shown to its next run. */
export const MAX_ROUTINE_RESULT_LENGTH = 2000;

/** Whether an AI routine's final answer means "nothing to report". */
export function isNoChange(text: string | null | undefined): boolean {
  const trimmed = (text ?? '').trim().replace(/^[`*_\s]+|[`*_.\s]+$/g, '');
  if (trimmed === '' || trimmed.toUpperCase() === NO_CHANGE) return true;
  // Models often explain themselves: "NO_CHANGE: still 0 open cases". A separator
  // right after the token keeps it a no-change answer; "NO_CHANGE but …" does not.
  return /^NO_CHANGE[*_`]*\s*(?:[:\-\u2013\u2014(]|\n)/i.test(trimmed);
}

export interface BotRoutine {
  /** Missing on original prompt routines. */
  kind?: RoutineKind;
  asset?: string;
  currencies?: string[];
  lastPrices?: Record<string, number>;
  runs?: RoutineRun[];
  /** The last result an AI routine posted, so its next run can report only what changed. */
  lastResult?: string;
  id: string;
  name: string;
  /** 5-field cron expression evaluated in the host's local time. */
  cron: string;
  prompt: string;
  enabled: boolean;
  /** Epoch ms of the last run attempt. */
  lastRunAt?: number;
}

export interface Bot {
  id: string;
  name: string;
  /** Most recently pinned bots appear first in the Basic sidebar. */
  pinnedAt?: number;
  /** Profile color for the bot's avatar blob (#rrggbb). */
  color?: string;
  /** Free-form personality / role description injected into the bot's instructions. */
  personality: string;
  /** Project the bot's threads run in. Bots are global; this is only an execution anchor. */
  projectId: string;
  providerId?: string;
  model?: string;
  /** The single visible thread that is the bot. Absent until first contact. */
  mainThreadId?: string;
  routines: BotRoutine[];
  createdAt: number;
  updatedAt: number;
}

export interface BotInput {
  name?: unknown;
  color?: unknown;
  personality?: unknown;
  projectId?: unknown;
  providerId?: unknown;
  model?: unknown;
}

export interface BotPatch extends BotInput {
  pinned?: unknown;
}

export interface RoutineInput {
  kind?: unknown;
  asset?: unknown;
  currencies?: unknown;
  name?: unknown;
  cron?: unknown;
  prompt?: unknown;
  enabled?: unknown;
}

export const MAX_BOTS = 50;
export const MAX_ROUTINES_PER_BOT = 20;
export const MAX_ACTIVE_JOBS_PER_BOT = 3;
export const MAX_NAME_LENGTH = 60;
export const MAX_PERSONALITY_LENGTH = 4_000;
export const MAX_PROMPT_LENGTH = 8_000;
/** Shortest gap between two firings of one routine, in minutes. */
export const MIN_ROUTINE_INTERVAL_MINUTES = 15;
export const DIRECT_INTERVAL_MINUTES = 10;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
/** Profile colors offered in the UI; any #rrggbb value is accepted. */
export const BOT_COLORS = ['#3b82f6', '#f97316', '#10b981', '#a855f7', '#ef4444', '#eab308', '#ec4899', '#14b8a6'] as const;

export class BotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BotValidationError';
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value: unknown): string | undefined {
  const trimmed = text(value);
  return trimmed ? trimmed : undefined;
}

/** Lowercase, dash-separated id derived from a display name. */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function validateName(value: unknown): string {
  const name = text(value);
  if (!name) throw new BotValidationError('name is required');
  if (CONTROL_CHARS.test(name)) throw new BotValidationError('name cannot contain line breaks or control characters');
  if (name.length > MAX_NAME_LENGTH) throw new BotValidationError(`name must be at most ${MAX_NAME_LENGTH} characters`);
  if (!slugify(name)) throw new BotValidationError('name must contain at least one letter or digit');
  return name;
}

function validateColor(value: unknown): string | undefined {
  const color = text(value).toLowerCase();
  if (!color) return undefined;
  if (!/^#[0-9a-f]{6}$/.test(color)) throw new BotValidationError('color must be a #rrggbb hex value');
  return color;
}

/** Stable default profile color for a bot id. */
export const BOT_SHAPES = ['blob', 'cloud', 'hexagon', 'round'] as const;
export type BotShape = (typeof BOT_SHAPES)[number];

function idHash(id: string, seed = 0, factor = 31): number {
  let hash = seed;
  for (const char of id) hash = (Math.imul(hash, factor) + char.charCodeAt(0)) >>> 0;
  return hash;
}

export function defaultBotColor(id: string): string {
  return BOT_COLORS[idHash(id) % BOT_COLORS.length]!;
}

/** Stable per-bot body shape, independent of the color pick so neighbours differ in both. */
export function defaultBotShape(id: string): BotShape {
  return BOT_SHAPES[(idHash(id, 2166136261, 16777619) >>> 7) % BOT_SHAPES.length]!;
}

function validatePersonality(value: unknown): string {
  const personality = text(value);
  if (personality.length > MAX_PERSONALITY_LENGTH) {
    throw new BotValidationError(`personality must be at most ${MAX_PERSONALITY_LENGTH} characters`);
  }
  return personality;
}

export function validatePrompt(value: unknown, field = 'prompt'): string {
  const prompt = text(value);
  if (!prompt) throw new BotValidationError(`${field} is required`);
  if (prompt.length > MAX_PROMPT_LENGTH) throw new BotValidationError(`${field} must be at most ${MAX_PROMPT_LENGTH} characters`);
  return prompt;
}

const CRON_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6]
];

function validCronToken(token: string, [min, max]: readonly [number, number]): boolean {
  if (token === '*') return true;
  const [base, step, ...rest] = token.split('/');
  if (rest.length > 0) return false;
  if (step !== undefined) {
    if (!/^\d+$/.test(step) || Number(step) <= 0 || Number(step) > max) return false;
  }
  if (base === '*') return step !== undefined;
  if (!/^\d+$/.test(base ?? '')) return false;
  const value = Number(base);
  return value >= min && value <= max;
}

/**
 * Validate against the host's cron matcher: 5 fields of `*`, numbers, comma
 * lists and `/` steps. Ranges (`1-5`) are not supported by the host matcher,
 * so they are expanded into comma lists here instead of silently never firing.
 */
export function normalizeCron(value: unknown): string {
  const raw = text(value).replace(/\s+/g, ' ');
  const fields = raw.split(' ');
  if (fields.length !== 5) throw new BotValidationError('cron must have 5 fields (minute hour day month weekday)');
  const normalized = fields.map((field, index) => {
    const range = CRON_RANGES[index]!;
    const tokens = field.split(',').flatMap((token) => {
      // Ranges, with an optional step (`8-20/2`), are expanded to explicit lists.
      const match = /^(\d+)-(\d+)(?:\/(\d+))?$/.exec(token);
      if (!match) return [token];
      const from = Number(match[1]);
      const to = Number(match[2]);
      const step = match[3] === undefined ? 1 : Number(match[3]);
      if (from > to) throw new BotValidationError(`cron range ${token} is reversed`);
      if (from < range[0] || to > range[1] || step < 1) throw new BotValidationError(`invalid cron field "${field}"`);
      return Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, offset) => String(from + offset * step));
    });
    for (const token of tokens) {
      if (!validCronToken(token, range)) throw new BotValidationError(`invalid cron field "${field}"`);
    }
    return tokens.join(',');
  });
  return normalized.join(' ');
}

function minutesOf(field: string): number[] | null {
  if (field === '*') return Array.from({ length: 60 }, (_, minute) => minute);
  const minutes = new Set<number>();
  for (const token of field.split(',')) {
    const [base, step] = token.split('/') as [string, string | undefined];
    const start = base === '*' ? 0 : Number(base);
    if (step === undefined) minutes.add(start);
    else for (let minute = start; minute < 60; minute += Number(step)) minutes.add(minute);
  }
  return [...minutes].sort((a, b) => a - b);
}

/** Include the gap across the hour boundary when enforcing the cadence. */
export function assertRoutineInterval(cron: string, minimum = MIN_ROUTINE_INTERVAL_MINUTES): void {
  const minutes = minutesOf(cron.split(' ')[0]!)!;
  if (minutes.length < 2) return;
  const gaps = minutes.map((minute, index) => (index === 0 ? minute + 60 - minutes.at(-1)! : minute - minutes[index - 1]!));
  if (Math.min(...gaps) < minimum) {
    throw new BotValidationError(`routines can run at most every ${minimum} minutes`);
  }
}

/** A cron that is valid for a routine: normalized and not too frequent. */
export function routineCron(value: unknown, kind: RoutineKind = 'agent'): string {
  const cron = normalizeCron(value);
  assertRoutineInterval(cron, kind === 'agent' ? MIN_ROUTINE_INTERVAL_MINUTES : DIRECT_INTERVAL_MINUTES);
  return cron;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function clock(hour: number, minute: number): string {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function dayList(field: string): string | null {
  if (field === '*') return 'Every day';
  const days = [...new Set(field.split(',').flatMap((token) => {
    const range = /^(\d)-(\d)$/.exec(token);
    if (!range) return [Number(token)];
    const from = Number(range[1]);
    return Array.from({ length: Math.max(0, Number(range[2]) - from + 1) }, (_, offset) => from + offset);
  }))].sort((a, b) => a - b);
  if (days.length === 0) return null;
  if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return null;
  const key = days.join(',');
  if (key === '1,2,3,4,5') return 'Weekdays';
  if (key === '0,6') return 'Weekends';
  if (days.length === 7) return 'Every day';
  if (days.length === 1) return `${WEEKDAYS[days[0]!]}s`;
  return days.map((day) => WEEKDAYS[day]!.slice(0, 3)).join(', ');
}

/**
 * Human-readable schedule for a 5-field cron, e.g. "Weekdays around 8:00 AM".
 * Falls back to "Custom · <cron>" for shapes it does not describe.
 */
export function describeCron(cron: string): string {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return `Custom · ${cron}`;
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];
  const calendarFree = dom === '*' && month === '*';
  if (calendarFree && /^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    const days = dayList(dow);
    if (days) return `${days} around ${clock(Number(hour), Number(minute))}`;
  }
  if (calendarFree && dow === '*' && hour === '*') {
    if (minute === '*') return 'Every minute';
    if (/^\d+$/.test(minute)) return `Every hour at :${minute.padStart(2, '0')}`;
    const step = /^\*\/(\d+)$/.exec(minute);
    if (step) return `Every ${step[1]} minutes`;
  }
  return `Custom · ${cron}`;
}

export function newBot(input: BotInput, id: string, now: number): Bot {
  const projectId = text(input.projectId);
  if (!projectId) throw new BotValidationError('projectId is required');
  return {
    id,
    name: validateName(input.name),
    ...(validateColor(input.color) ? { color: validateColor(input.color) } : {}),
    personality: validatePersonality(input.personality),
    projectId,
    ...(optionalText(input.providerId) ? { providerId: optionalText(input.providerId) } : {}),
    ...(optionalText(input.model) ? { model: optionalText(input.model) } : {}),
    routines: [],
    createdAt: now,
    updatedAt: now
  };
}

export function patchBot(bot: Bot, input: BotPatch, now: number): Bot {
  const next: Bot = { ...bot, updatedAt: now };
  if (input.pinned !== undefined) {
    if (typeof input.pinned !== 'boolean') throw new BotValidationError('pinned must be a boolean');
    if (input.pinned) next.pinnedAt ??= now;
    else delete next.pinnedAt;
  }
  if (input.name !== undefined) next.name = validateName(input.name);
  if (input.color !== undefined) {
    const color = validateColor(input.color);
    if (color) next.color = color;
    else delete next.color;
  }
  if (input.personality !== undefined) next.personality = validatePersonality(input.personality);
  if (input.projectId !== undefined) {
    const projectId = text(input.projectId);
    if (!projectId) throw new BotValidationError('projectId cannot be empty');
    next.projectId = projectId;
  }
  for (const key of ['providerId', 'model'] as const) {
    if (input[key] === undefined) continue;
    const value = optionalText(input[key]);
    if (value) next[key] = value;
    else delete next[key];
  }
  return next;
}

export function newRoutine(input: RoutineInput, id: string): BotRoutine {
  const kind = input.kind === undefined ? 'agent' : input.kind;
  if (typeof kind !== 'string' || !Object.hasOwn(ROUTINE_KINDS, kind)) throw new BotValidationError('Unknown routine kind');
  const directPrice = kind === 'price';
  const routine: BotRoutine = {
    id, name: validateName(input.name), cron: routineCron(input.cron, kind as RoutineKind),
    ...(kind === 'agent' ? {} : { kind: kind as RoutineKind }),
    prompt: directPrice ? '' : validatePrompt(input.prompt),
    enabled: input.enabled === undefined ? true : input.enabled === true
  };
  if (directPrice) {
    if (input.prompt) throw new BotValidationError('Price checks take asset and currencies. Use an AI prompt for additional instructions.');
    const asset = text(input.asset).toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(asset)) throw new BotValidationError('Enter an asset symbol such as BTC');
    if (!Array.isArray(input.currencies) || !input.currencies.length || input.currencies.length > 4) {
      throw new BotValidationError('Choose one to four quote currencies');
    }
    const currencies = input.currencies.map(value => text(value).toUpperCase());
    if (currencies.some(code => !/^[A-Z]{3}$/.test(code))) throw new BotValidationError('Use three-letter quote currencies such as USD');
    routine.asset = asset;
    routine.currencies = [...new Set(currencies)];
  } else if (input.asset !== undefined || input.currencies !== undefined) {
    throw new BotValidationError('Only price checks accept asset and currencies');
  }
  return routine;
}

export function patchRoutine(routine: BotRoutine, input: RoutineInput): BotRoutine {
  const kind = input.kind === undefined ? routine.kind ?? 'agent' : input.kind;
  const sameKind = kind === (routine.kind ?? 'agent');
  const next = newRoutine({
    kind, name: input.name === undefined ? routine.name : input.name,
    cron: input.cron === undefined ? routine.cron : input.cron,
    enabled: input.enabled === undefined ? routine.enabled : input.enabled,
    prompt: input.prompt === undefined && sameKind ? routine.prompt : input.prompt,
    asset: input.asset === undefined && sameKind ? routine.asset : input.asset,
    currencies: input.currencies === undefined && sameKind ? routine.currencies : input.currencies,
  }, routine.id);
  if (routine.lastRunAt !== undefined) next.lastRunAt = routine.lastRunAt;
  if (routine.runs) next.runs = routine.runs;
  if (routine.lastResult && sameKind && next.prompt === routine.prompt) next.lastResult = routine.lastResult;
  if (next.kind === 'price' && next.asset === routine.asset && routine.lastPrices) next.lastPrices = routine.lastPrices;
  return next;
}

/** Resolve a user-typed reference (id, exact name, or slug of name) to a bot. */
export function findBot(bots: readonly Bot[], ref: string): Bot | undefined {
  const needle = ref.trim();
  if (!needle) return undefined;
  const lower = needle.toLowerCase();
  const slug = slugify(needle);
  return (
    bots.find((bot) => bot.id === needle)
    ?? bots.find((bot) => bot.name.toLowerCase() === lower)
    ?? (slug ? bots.find((bot) => slugify(bot.name) === slug) : undefined)
  );
}

/** Memory tag shared by every thread of one bot. */
export function botMemoryTag(bot: Pick<Bot, 'id'>): string {
  return `bot:${bot.id}`;
}

/**
 * Quote any line of untrusted text that could pass for one of our headers, so
 * a message cannot forge "[Routine: …]", "[From …]" or "[Reply from bot …]".
 */
export function quoteHeaders(body: string): string {
  return body.replace(/^[ \t]*\[/gm, '> [');
}

/** Who a delivery shows as in the receiving thread (stamped with this plugin's id by the host). */
export interface DeliverySource {
  kind: 'bot' | 'thread' | 'user' | 'routine' | 'job';
  label: string;
  color?: string;
  threadId?: string;
  detail?: string;
}

/**
 * One message for a thread: `prompt` is what people see, `agentContext` the
 * agent-only header naming the sender, `source` how the thread labels it.
 * Bodies keep `quoteHeaders`, so a body cannot fake a second header.
 */
export interface Delivery {
  prompt: string;
  agentContext: string;
  source: DeliverySource;
}

export function routineDelivery(routine: BotRoutine): Delivery {
  return {
    prompt: quoteHeaders(routine.prompt),
    agentContext: `[Routine: ${routine.name}]`,
    source: { kind: 'routine', label: routine.name, detail: 'routine' }
  };
}

/**
 * The prompt of one quiet AI routine run. It carries the last posted result so
 * the run can report only what changed, and answer NO_CHANGE otherwise.
 */
export function routineRunDelivery(routine: BotRoutine): Delivery {
  const previous = routine.lastResult
    ? ['', 'Your last posted result for this routine (between the markers):', '<<<last-result', quoteHeaders(routine.lastResult).replace(/^(<<<last-result|last-result>>>)$/gm, '> $1'), 'last-result>>>'].join('\n')
    : '';
  return {
    prompt: quoteHeaders(routine.prompt) + previous,
    agentContext: `[Routine: ${routine.name}]`,
    source: { kind: 'routine', label: routine.name, detail: 'routine' }
  };
}

export type InboundSource =
  | { kind: 'user'; via: string }
  | { kind: 'thread'; threadId: string; title?: string | null }
  | { kind: 'bot'; bot: Pick<Bot, 'id' | 'name' | 'color'>; threadId: string };

/** Single display line for a thread title used as a label. */
export function displayLabel(value: string | null | undefined, fallback: string): string {
  const line = (value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2028\u2029\u2066-\u2069]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!line) return fallback;
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

function botSource(bot: Pick<Bot, 'id' | 'name' | 'color'>, threadId: string | undefined, detail: string): DeliverySource {
  return {
    kind: 'bot',
    label: bot.name,
    color: bot.color ?? defaultBotColor(bot.id),
    ...(threadId ? { threadId } : {}),
    detail
  };
}

export function inboundDelivery(message: string, from: InboundSource): Delivery {
  const prompt = quoteHeaders(message);
  if (from.kind === 'user') {
    return { prompt, agentContext: `[From the user (${from.via})]`, source: { kind: 'user', label: 'You', detail: `via ${from.via}` } };
  }
  if (from.kind === 'bot') {
    return {
      prompt,
      agentContext: `[From bot ${from.bot.name}, thread ${from.threadId}]`,
      source: botSource(from.bot, from.threadId, 'messaged')
    };
  }
  return {
    prompt,
    agentContext: `[From thread ${from.threadId}]`,
    source: { kind: 'thread', label: displayLabel(from.title, 'A thread'), threadId: from.threadId, detail: 'messaged' }
  };
}

/** A bot answering a thread; links back to the bot's main thread. */
export function replyDelivery(bot: Pick<Bot, 'id' | 'name' | 'color' | 'mainThreadId'>, message: string): Delivery {
  return {
    prompt: quoteHeaders(message),
    agentContext: `[Reply from bot ${bot.name}]`,
    source: botSource(bot, bot.mainThreadId, 'replied')
  };
}

/** The task a bot hands to one of its background jobs. */
export function jobDelivery(bot: Pick<Bot, 'id' | 'name' | 'color' | 'mainThreadId'>, prompt: string): Delivery {
  return { prompt, agentContext: `[Job from bot ${bot.name}]`, source: botSource(bot, bot.mainThreadId, 'started this job') };
}
