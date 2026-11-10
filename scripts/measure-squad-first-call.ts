/**
 * Read-only measurement of a Squad worker's first model call (leanWorkers acceptance check).
 *
 * Scans Claude transcripts (`~/.claude/projects/<project>/<session>.jsonl`), keeps sessions whose
 * first user message starts with the worker standby prefix, and reports the median
 * `input + cache_creation + cache_read` tokens of each session's first assistant message.
 * Sessions at or after `--lean-after` form the lean group, earlier ones the baseline.
 * It writes nothing and calls no model.
 *
 *   pnpm exec tsx scripts/measure-squad-first-call.ts \
 *     --lean-after 2026-11-06T00:00:00Z --version 2.1.316 [--entrypoint cli] [--root ~/.claude/projects] \
 *     [--project-contains zana] [--min-baseline 5] [--min-lean 3]
 *
 * Pin one Claude CLI version with --version: baselines differ (about 23k vs 44k) across versions.
 * Exit code 0 = reduction >= 0.20, 1 = below the bar, 2 = not enough sessions or bad arguments.
 */
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const WORKER_PREFIX = 'Team worker standby. You are';
export const REQUIRED_REDUCTION = 0.2;
/** Tolerance so floating-point error (1 - 80/100 = 0.19999999999999996) cannot fail the exact boundary. */
export const REDUCTION_EPSILON = 1e-9;

export interface FirstCallSample {
  sessionId: string;
  version?: string;
  entrypoint?: string;
  startedAt?: string;
  tokens: number;
}

interface Usage { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }

function firstText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  for (const part of content) {
    if (part && typeof part === 'object' && (part as { type?: unknown }).type === 'text'
      && typeof (part as { text?: unknown }).text === 'string') return (part as { text: string }).text;
  }
  return undefined;
}

/** Sum of the three prompt-side token counters; missing counters count as 0. */
export function firstCallTokens(usage: Usage): number {
  return (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
}

/**
 * Parse one transcript. Returns a sample only when the first user message starts with the worker
 * standby prefix and a later assistant message carries usage. Malformed lines are skipped.
 */
export function parseTranscript(jsonl: string, fallbackSessionId = ''): FirstCallSample | undefined {
  let header: { version?: string; entrypoint?: string; startedAt?: string; sessionId?: string } | undefined;
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let row: any;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== 'object') continue;
    if (!header) {
      if (row.type !== 'user') continue;
      const text = firstText(row.message?.content);
      if (text === undefined || !text.startsWith(WORKER_PREFIX)) return undefined;
      header = {
        ...(typeof row.version === 'string' ? { version: row.version } : {}),
        ...(typeof row.entrypoint === 'string' ? { entrypoint: row.entrypoint } : {}),
        ...(typeof row.timestamp === 'string' ? { startedAt: row.timestamp } : {}),
        ...(typeof row.sessionId === 'string' ? { sessionId: row.sessionId } : {})
      };
      continue;
    }
    if (row.type === 'assistant' && row.message?.usage && typeof row.message.usage === 'object') {
      return { sessionId: header.sessionId ?? fallbackSessionId, ...header, tokens: firstCallTokens(row.message.usage) };
    }
  }
  return undefined;
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export interface MeasureOptions {
  leanAfter: string;
  version?: string;
  entrypoint?: string;
  minBaseline?: number;
  minLean?: number;
}

export interface MeasureResult {
  baselineCount: number;
  leanCount: number;
  baselineMedian?: number;
  leanMedian?: number;
  reduction?: number;
  verdict: 'pass' | 'fail' | 'insufficient-sessions';
  reason?: string;
}

/** Filter by version/entrypoint, split at `leanAfter`, and compute `1 - median_lean / median_baseline`. */
export function summarize(samples: readonly FirstCallSample[], options: MeasureOptions): MeasureResult {
  const entrypoint = options.entrypoint ?? 'cli';
  const cutoff = Date.parse(options.leanAfter);
  if (Number.isNaN(cutoff)) throw new Error(`invalid --lean-after: ${options.leanAfter}`);
  const kept = samples.filter((s) => s.entrypoint === entrypoint
    && (options.version === undefined || s.version === options.version)
    && s.startedAt !== undefined && !Number.isNaN(Date.parse(s.startedAt)));
  const lean = kept.filter((s) => Date.parse(s.startedAt!) >= cutoff).map((s) => s.tokens);
  const baseline = kept.filter((s) => Date.parse(s.startedAt!) < cutoff).map((s) => s.tokens);
  const base = { baselineCount: baseline.length, leanCount: lean.length };
  const minBaseline = options.minBaseline ?? 5;
  const minLean = options.minLean ?? 3;
  if (baseline.length < minBaseline || lean.length < minLean) {
    return { ...base, verdict: 'insufficient-sessions',
      reason: `need >= ${minBaseline} baseline and >= ${minLean} lean sessions; found ${baseline.length} and ${lean.length}` };
  }
  const baselineMedian = median(baseline)!;
  const leanMedian = median(lean)!;
  const reduction = baselineMedian > 0 ? 1 - leanMedian / baselineMedian : 0;
  return { ...base, baselineMedian, leanMedian, reduction, verdict: reduction + REDUCTION_EPSILON >= REQUIRED_REDUCTION ? 'pass' : 'fail' };
}

async function* transcriptFiles(root: string, projectContains?: string): AsyncGenerator<string> {
  for (const project of await readdir(root, { withFileTypes: true })) {
    if (!project.isDirectory() || (projectContains && !project.name.includes(projectContains))) continue;
    for (const file of await readdir(join(root, project.name))) {
      if (file.endsWith('.jsonl')) yield join(root, project.name, file);
    }
  }
}

export async function collectSamples(root: string, projectContains?: string): Promise<FirstCallSample[]> {
  const samples: FirstCallSample[] = [];
  for await (const path of transcriptFiles(root, projectContains)) {
    const sample = parseTranscript(await readFile(path, 'utf8'), basename(path, '.jsonl'));
    if (sample) samples.push(sample);
  }
  return samples;
}

export function parseArgs(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`bad argument near ${key ?? '(end)'}`);
    out[key.slice(2)] = value;
  }
  return out;
}

/** Strict positive-integer parse for count flags; throws a usage error otherwise. */
export function parsePositiveInt(flag: string, raw: string): number {
  if (!/^[1-9][0-9]*$/.test(raw.trim())) throw new Error(`invalid --${flag}: expected a positive integer, got "${raw}"`);
  const n = Number(raw.trim());
  if (!Number.isSafeInteger(n)) throw new Error(`invalid --${flag}: expected a positive integer, got "${raw}"`);
  return n;
}

/** CLI body. Returns the process exit code: 0 pass, 1 fail, 2 insufficient sessions or bad arguments. */
export async function run(argv: readonly string[]): Promise<number> {
  try {
    const args = parseArgs(argv);
    if (!args['lean-after']) throw new Error('--lean-after <ISO timestamp> is required');
    const minBaseline = args['min-baseline'] !== undefined ? parsePositiveInt('min-baseline', args['min-baseline']) : undefined;
    const minLean = args['min-lean'] !== undefined ? parsePositiveInt('min-lean', args['min-lean']) : undefined;
    const root = args.root ?? join(homedir(), '.claude', 'projects');
    const samples = await collectSamples(root, args['project-contains']);
    const result = summarize(samples, {
      leanAfter: args['lean-after'],
      ...(args.version ? { version: args.version } : {}),
      ...(args.entrypoint ? { entrypoint: args.entrypoint } : {}),
      ...(minBaseline !== undefined ? { minBaseline } : {}),
      ...(minLean !== undefined ? { minLean } : {})
    });
    console.log(JSON.stringify({ workerSessionsScanned: samples.length, ...result }, null, 2));
    return result.verdict === 'pass' ? 0 : result.verdict === 'fail' ? 1 : 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

/* c8 ignore start */
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(await run(process.argv.slice(2)));
}
/* c8 ignore stop */
