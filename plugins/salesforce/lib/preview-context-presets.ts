import { randomUUID } from 'node:crypto';
import { CONTEXT_PRESET_LIMITS, type ContextPreset, type PresetField } from './preview-context-preset-contract.js';
import { parsePreviewContext } from './preview-context.js';

interface Kv { get<T>(key: string): Promise<T | null | undefined>; set(key: string, value: unknown): Promise<void> }
interface PresetDatabase {
  runScript(sql: string): void;
  prepare(sql: string): { get(...params: unknown[]): unknown; run(...params: unknown[]): unknown };
}
/** Preset collections exceed the SDK's 256 KB KV limit; SQLite commits each replacement atomically. */
export function contextPresetStorage(database: () => PresetDatabase): Kv {
  let ready = false;
  const db = () => {
    const value = database();
    if (!ready) { value.runScript('CREATE TABLE IF NOT EXISTS preview_context_presets (project_key TEXT PRIMARY KEY, payload TEXT NOT NULL)'); ready = true; }
    return value;
  };
  return {
    async get<T>(key: string) {
      const row = db().prepare('SELECT payload FROM preview_context_presets WHERE project_key = ?').get(key) as { payload: string } | undefined;
      return row ? JSON.parse(row.payload) as T : undefined;
    },
    async set(key, value) { db().prepare('INSERT INTO preview_context_presets (project_key, payload) VALUES (?, ?) ON CONFLICT(project_key) DO UPDATE SET payload = excluded.payload').run(key, JSON.stringify(value)); }
  };
}
export interface PresetScope { projectId: string; key: string; orgLabel: string }
type StoredPreset = ContextPreset & { scope: string };
export class ContextPresetError extends Error {
  constructor(message: string, readonly code = 'invalid_input') { super(message); }
}
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

function parseFields(value: unknown): PresetField[] {
  if (!Array.isArray(value) || value.length > 100) throw new ContextPresetError('A preset supports at most 100 field definitions.');
  const names = new Set<string>();
  return value.map(raw => {
    const row = record(raw);
    parsePreviewContext([{ name: row.name, type: row.type, value: null }]);
    if (names.has(row.name as string) || typeof row.declared !== 'boolean' || typeof row.label !== 'string' || row.label.length > 160) throw new ContextPresetError('Choose unique fields with valid labels and declaration metadata.');
    names.add(row.name as string);
    return { name: row.name as string, type: row.type as PresetField['type'], label: row.label,
      declared: row.declared, ...(typeof row.source === 'string' ? { source: row.source.slice(0, 256) } : {}) };
  });
}

/** One bounded, serialized store per registered project. Scope keys are resolved by the server. */
export class ContextPresets {
  private chains = new Map<string, Promise<unknown>>();
  constructor(private readonly kv: Kv, private readonly now = Date.now, private readonly uuid: () => string = randomUUID) {}
  private storageKey(scope: PresetScope) { return `sf:project:${scope.projectId}:context-presets`; }
  private async rows(scope: PresetScope): Promise<StoredPreset[]> {
    const rows = await this.kv.get<StoredPreset[]>(this.storageKey(scope));
    if (rows === null || rows === undefined) return [];
    if (!Array.isArray(rows) || rows.length > CONTEXT_PRESET_LIMITS.perProject || rows.some(p => !p || typeof p.scope !== 'string' || typeof p.id !== 'string' || typeof p.name !== 'string' || !Number.isInteger(p.revision) || !Array.isArray(p.values) || !Array.isArray(p.fields))) throw new ContextPresetError('Preset storage could not be read. Reload before saving.', 'storage_failed');
    return rows;
  }
  async list(scope: PresetScope): Promise<ContextPreset[]> {
    return (await this.rows(scope)).filter(p => p.scope === scope.key).map(({ scope: _scope, ...p }) => structuredClone(p));
  }
  async save(scope: PresetScope, input: unknown): Promise<ContextPreset> {
    const raw = record(input);
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name || name.length > 60 || /[\u0000-\u001f]/.test(name)) throw new ContextPresetError('Enter a preset name between 1 and 60 characters.');
    if (raw.expectedScope !== scope.key) throw new ContextPresetError('The selected agent or org changed. Reload presets before saving.', 'scope_changed');
    const values = parsePreviewContext(raw.values);
    const fields = parseFields(raw.fields);
    for (const value of values) if (!fields.some(f => f.name === value.name && f.type === value.type)) throw new ContextPresetError(`Missing field definition for ${value.name}.`);
    const key = this.storageKey(scope);
    const work = async () => {
      const rows = await this.rows(scope);
      const scoped = rows.filter(p => p.scope === scope.key);
      const id = typeof raw.id === 'string' ? raw.id : '';
      const existing = id ? scoped.find(p => p.id === id) : undefined;
      if (id && !existing) throw new ContextPresetError('This preset is no longer available. Reload presets before saving.', 'not_found');
      if (existing && raw.expectedRevision !== existing.revision) throw new ContextPresetError('This preset changed in another window. Reload presets or save a copy.', 'revision_mismatch');
      if (scoped.some(p => p.id !== id && p.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new ContextPresetError('A preset with this name already exists. Choose another name.');
      if (!existing && (scoped.length >= CONTEXT_PRESET_LIMITS.perAgent || rows.length >= CONTEXT_PRESET_LIMITS.perProject)) throw new ContextPresetError('Preset storage is full (20 per agent and org, 100 per project). Update an existing preset instead.', 'limit');
      const saved: StoredPreset = { scope: scope.key, id: existing?.id ?? this.uuid(), name, revision: (existing?.revision ?? 0) + 1, updatedAt: this.now(), values, fields };
      const next = [...rows.filter(p => p !== existing), saved];
      if (new TextEncoder().encode(JSON.stringify(next)).length > CONTEXT_PRESET_LIMITS.bytes) throw new ContextPresetError('Presets for this project must fit within 4 MB. Reduce large values before saving.', 'limit');
      await this.kv.set(key, next);
      const { scope: _scope, ...result } = saved;
      return structuredClone(result);
    };
    const next = (this.chains.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
    this.chains.set(key, next);
    try { return await next; }
    finally { if (this.chains.get(key) === next) this.chains.delete(key); }
  }
}

export function registerContextPresets(o: {
  registerRpc(name: string, handler: (args: unknown) => unknown): void;
  store: ContextPresets;
  resolveScope(args: unknown): Promise<PresetScope>;
  changed(projectId: string): void;
}) {
  for (const method of ['list', 'save'] as const) o.registerRpc(`agentPreview.presets.${method}`, async args => {
    try {
      const scope = await o.resolveScope(args);
      if (method === 'list') return { ok: true, presets: await o.store.list(scope), scopeKey: scope.key, orgLabel: scope.orgLabel };
      const preset = await o.store.save(scope, args);
      o.changed(scope.projectId);
      return { ok: true, preset };
    } catch (error) { return { ok: false, code: error instanceof ContextPresetError ? error.code : 'failed', error: (error as Error).message }; }
  });
}
