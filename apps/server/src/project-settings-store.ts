import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ProjectSettingsPatchSchema, type ProjectSettingsPatch } from '@zana-ai/zcc-contracts/project-settings';
import { atomicDurableWrite, createSerializedTransactionQueue } from './durable-store.js';

type StoredProjectSettings = Record<string, unknown>;
type SettingsByProject = Record<string, StoredProjectSettings>;

const HARNESS_FAMILIES = ['claude', 'cursor', 'codex', 'pi', 'opencode'] as const;
const RETIRED_PROJECT_SETTINGS_KEYS = [
  'model', 'permissionMode', 'appendSystemPrompt', 'extraArgs', 'addDirs', 'allowedTools',
  'deniedTools', 'codexSandbox', 'codexApproval', 'piProvider', 'piModel', 'piThinking'
] as const;

export interface ProjectSettingsStoreOptions {
  projectSettingsFile: string;
}

export interface ProjectSettingsStore {
  get(id: string): StoredProjectSettings;
  set(id: string, patch: ProjectSettingsPatch): Promise<StoredProjectSettings>;
  remove(id: string): Promise<void>;
}

interface Snapshot {
  all: SettingsByProject;
  hash: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clone(value: Record<string, unknown>): StoredProjectSettings {
  return JSON.parse(JSON.stringify(value)) as StoredProjectSettings;
}

function setOrDelete(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined) delete target[key];
  else target[key] = value;
}

function compatibility(settings: StoredProjectSettings): StoredProjectSettings {
  const next = { ...settings };
  const byId = isRecord(settings.harnesses) && isRecord(settings.harnesses.byId)
    ? settings.harnesses.byId
    : undefined;
  const entry = (id: string) => isRecord(byId?.[id]) && isRecord((byId[id] as Record<string, unknown>).compatibility)
    ? (byId[id] as Record<string, unknown>).compatibility as Record<string, unknown>
    : undefined;
  const claude = entry('claude');
  const codex = entry('codex');
  const pi = entry('pi');
  if (claude?.model !== undefined) next.model = claude.model;
  if (claude?.permissionMode !== undefined) next.permissionMode = claude.permissionMode;
  for (const key of ['appendSystemPrompt', 'extraArgs', 'addDirs', 'allowedTools', 'deniedTools']) {
    if (claude?.[key] !== undefined) next[key] = claude[key];
  }
  if (codex?.codexSandbox !== undefined) next.codexSandbox = codex.codexSandbox;
  if (codex?.codexApproval !== undefined) next.codexApproval = codex.codexApproval;
  if (pi?.provider !== undefined) next.piProvider = pi.provider;
  if (pi?.model !== undefined) next.piModel = pi.model;
  if (pi?.thinking !== undefined) next.piThinking = pi.thinking;
  return next;
}

function normalize(input: StoredProjectSettings): StoredProjectSettings {
  const { harnesses, harnessRouting, ...legacy } = input;
  const normalized: StoredProjectSettings = { ...legacy };
  if (isRecord(harnesses) && isRecord(harnesses.byId)) {
    const byId: Record<string, unknown> = {};
    for (const [id, entry] of Object.entries(harnesses.byId)) {
      if (!isRecord(entry) || !isRecord(entry.compatibility) || Object.keys(entry.compatibility).length === 0) continue;
      byId[id] = { compatibility: clone(entry.compatibility) };
    }
    if (Object.keys(byId).length) normalized.harnesses = { byId };
  }
  if (isRecord(harnessRouting) && harnessRouting.schemaVersion === 1 && isRecord(harnessRouting.byAdapter)) {
    normalized.harnessRouting = harnessRouting;
  }
  return normalized;
}

function pruneEmptyHarnesses(harnesses: Record<string, unknown>): void {
  const byId = isRecord(harnesses.byId) ? harnesses.byId : undefined;
  if (!byId) return;
  for (const id of HARNESS_FAMILIES) {
    const entry = isRecord(byId[id]) ? byId[id] : undefined;
    if (!entry) continue;
    const current = isRecord(entry.compatibility) ? entry.compatibility : undefined;
    if (current && Object.keys(current).length === 0) delete entry.compatibility;
    if (Object.keys(entry).length === 0) delete byId[id];
  }
  if (Object.keys(byId).length === 0) delete harnesses.byId;
}

function canonicalForWrite(settings: StoredProjectSettings): StoredProjectSettings {
  const next = clone(settings);
  const source = settings;
  const harnesses = isRecord(next.harnesses) ? next.harnesses : (next.harnesses = {});
  const byId = isRecord(harnesses.byId) ? harnesses.byId : (harnesses.byId = {});
  const compat = (id: string): Record<string, unknown> => {
    const entry = isRecord(byId[id]) ? byId[id] : (byId[id] = {});
    return isRecord(entry.compatibility) ? entry.compatibility : (entry.compatibility = {});
  };
  const claude = compat('claude');
  const codex = compat('codex');
  const pi = compat('pi');
  setOrDelete(claude, 'model', source.model);
  setOrDelete(codex, 'model', source.model);
  setOrDelete(claude, 'permissionMode', source.permissionMode);
  for (const key of ['appendSystemPrompt', 'extraArgs', 'addDirs', 'allowedTools', 'deniedTools']) {
    setOrDelete(claude, key, source[key]);
  }
  setOrDelete(codex, 'codexSandbox', source.codexSandbox);
  setOrDelete(codex, 'codexApproval', source.codexApproval);
  setOrDelete(pi, 'provider', source.piProvider);
  setOrDelete(pi, 'model', source.piModel);
  setOrDelete(pi, 'thinking', source.piThinking);
  for (const key of RETIRED_PROJECT_SETTINGS_KEYS) delete next[key];
  pruneEmptyHarnesses(harnesses);
  if (!harnesses.byId) delete next.harnesses;
  return next;
}

function readSnapshot(path: string): Snapshot {
  try {
    if (!existsSync(path)) return { all: {}, hash: null };
    const bytes = readFileSync(path);
    const hash = createHash('sha256').update(bytes).digest('hex');
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      // Match the legacy readJsonRaw fallback while retaining the observed hash
      // so an unrelated external repair cannot be overwritten mid-migration.
      parsed = {};
    }
    return {
      all: isRecord(parsed) ? parsed as SettingsByProject : {},
      hash
    };
  } catch {
    return { all: {}, hash: null };
  }
}

/** Server-owned, serialized persistence for app-managed per-project settings. */
export function createProjectSettingsStore({ projectSettingsFile }: ProjectSettingsStoreOptions): ProjectSettingsStore {
  const queue = createSerializedTransactionQueue();
  const write = (all: SettingsByProject, expectedHash: string | null) => {
    const directory = dirname(projectSettingsFile);
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
    atomicDurableWrite(projectSettingsFile, Buffer.from(JSON.stringify(all, null, 2)), { expectedHash });
  };

  return {
    get(id) {
      return compatibility(readSnapshot(projectSettingsFile).all[id] ?? {});
    },
    set(id, patch) {
      return queue.run(async () => {
        const parsed = ProjectSettingsPatchSchema.parse(patch);
        const { all, hash } = readSnapshot(projectSettingsFile);
        const current = compatibility(all[id] ?? {});
        const next = normalize({ ...current, ...parsed });
        all[id] = canonicalForWrite(next);
        write(all, hash);
        return next;
      });
    },
    remove(id) {
      return queue.run(async () => {
        const { all, hash } = readSnapshot(projectSettingsFile);
        if (!(id in all)) return;
        delete all[id];
        write(all, hash);
      });
    }
  };
}
