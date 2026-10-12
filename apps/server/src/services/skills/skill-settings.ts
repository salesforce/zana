import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

function settingsFile(): string {
  const home = process.env.ZCC_CLAUDE_HOME || homedir();
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim();
  const dir = configured
    ? configured.startsWith('~/')
      ? join(home, configured.slice(2))
      : resolve(home, configured)
    : join(home, '.claude');
  return join(dir, 'settings.json');
}
let settingsTail: Promise<unknown> = Promise.resolve();
function serializeSettings<T>(operation: () => Promise<T>): Promise<T> {
  const result = settingsTail.then(operation, operation);
  settingsTail = result.catch(() => undefined);
  return result;
}

async function readSettings(): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(settingsFile(), 'utf-8');
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function writeSettings(settings: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(settingsFile()), { recursive: true });
  const tmp = `${settingsFile()}.tmp.${randomBytes(4).toString('hex')}`;
  try {
    await writeFile(tmp, JSON.stringify(settings, null, 2), { encoding: 'utf-8', mode: 0o600 });
    await rename(tmp, settingsFile());
  } finally {
    await rm(tmp, { force: true });
  }
}

/**
 * Read settings AND fold any legacy `disabledSkills: string[]` into
 * `skillOverrides: { name: 'off' }`, then drop the legacy key. Idempotent —
 * after the first call on a settings file, the legacy key is gone and the
 * fold is a no-op. This is necessary because Claude Code only honors
 * `skillOverrides` (https://code.claude.com/docs/en/settings.md), so any
 * older `disabledSkills` entries we wrote previously had no real effect.
 *
 * NOTE: `skillOverrides` is a CLAUDE-specific mechanism — it lives in
 * `~/.claude/settings.json` and is keyed by short skill name. It stays owned
 * here (the Claude toggle path); other tools' toggle state lives in their own
 * files and never touches this settings file.
 */
async function readSettingsWithMigration(): Promise<Record<string, unknown>> {
  const settings = await readSettings();
  const legacy = settings.disabledSkills;
  if (Array.isArray(legacy) && legacy.length > 0) {
    const raw = settings.skillOverrides;
    const overrides =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? ({ ...raw } as Record<string, string>)
        : {};
    let migrated = 0;
    for (const name of legacy) {
      if (typeof name !== 'string') continue;
      if (overrides[name] !== 'off') {
        overrides[name] = 'off';
        migrated += 1;
      }
    }
    settings.skillOverrides = overrides;
    delete settings.disabledSkills;
    await writeSettings(settings);
    if (migrated > 0) {
      // eslint-disable-next-line no-console
      console.log(`[main] migrated ${migrated} entries from disabledSkills to skillOverrides`);
    }
  } else if (legacy !== undefined) {
    // Legacy key present but empty — drop it without bothering to log.
    delete settings.disabledSkills;
    await writeSettings(settings);
  }
  return settings;
}

export async function disabledSkillNames(): Promise<Set<string>> {
  return serializeSettings(async () =>
    disabledNamesFromOverrides(await readSettingsWithMigration())
  );
}

function disabledNamesFromOverrides(settings: Record<string, unknown>): Set<string> {
  const overrides = settings.skillOverrides;
  if (!overrides || typeof overrides !== 'object') return new Set();
  const out = new Set<string>();
  for (const [name, value] of Object.entries(overrides as Record<string, unknown>)) {
    if (value === 'off') out.add(name);
  }
  return out;
}

export function setSkillEnabled(name: string, enabled: boolean): Promise<void> {
  return setManyEnabled([{ name, enabled }]);
}
export function setManyEnabled(updates: Array<{ name: string; enabled: boolean }>): Promise<void> {
  if (!updates.length) return Promise.resolve();
  return serializeSettings(async () => {
    const settings = await readSettingsWithMigration();
    const raw = settings.skillOverrides;
    const overrides =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? ({ ...raw } as Record<string, string>)
        : {};
    for (const { name, enabled } of updates) overrides[name] = enabled ? 'on' : 'off';
    settings.skillOverrides = overrides;
    await writeSettings(settings);
  });
}

export async function readHooks(): Promise<unknown> {
  const settings = await readSettings();
  return settings.hooks ?? null;
}
