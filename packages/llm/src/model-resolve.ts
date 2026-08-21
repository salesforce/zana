/**
 * Resolve bare family aliases (opus/sonnet/haiku) to concrete model IDs by
 * reading the user's ~/.claude/settings.json `model` field.
 *
 * On Bedrock gateways the CLI's internal alias table lags behind new releases,
 * so `--model opus` can resolve to a stale version (e.g. 4-6 instead of 4-8).
 * The user's settings.json `"model"` field is the single source of truth for
 * their intended concrete model — when it matches the requested family, we
 * substitute it so the CLI never relies on its internal alias table.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type SettingsFileResolver = () => string;

const defaultSettingsFile = (): string =>
  join(process.env.ZCC_CLAUDE_HOME || homedir(), '.claude', 'settings.json');

let getSettingsFile: SettingsFileResolver = defaultSettingsFile;

/** Inject the Claude `settings.json` path. Pass `null` to restore the default. */
export function setSettingsFileResolver(resolver: SettingsFileResolver | null): void {
  getSettingsFile = resolver ?? defaultSettingsFile;
  cachedModel = undefined;
  cacheTime = 0;
}

const FAMILY_PATTERNS: Record<string, RegExp> = {
  fable: /fable/i,
  opus: /opus/i,
  sonnet: /sonnet/i,
  haiku: /haiku/i
};

let cachedModel: string | null | undefined;
let cacheTime = 0;
const CACHE_TTL_MS = 30_000;

function readUserModel(): string | null {
  const now = Date.now();
  if (cachedModel !== undefined && now - cacheTime < CACHE_TTL_MS) {
    return cachedModel;
  }
  try {
    const file = getSettingsFile();
    if (!existsSync(file)) { cachedModel = null; cacheTime = now; return null; }
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    const m = typeof raw?.model === 'string' ? raw.model : null;
    cachedModel = m;
    cacheTime = now;
    return m;
  } catch {
    cachedModel = null;
    cacheTime = Date.now();
    return null;
  }
}

/**
 * If `model` is a bare family alias and the user's settings.json has a concrete
 * model ID in the same family, return that concrete ID. Otherwise pass through.
 */
export function resolveModelAlias(model: string): string {
  const pattern = FAMILY_PATTERNS[model.toLowerCase()];
  if (!pattern) return model; // not a bare alias — pass through
  const userModel = readUserModel();
  if (userModel && pattern.test(userModel)) return userModel;
  return model;
}
