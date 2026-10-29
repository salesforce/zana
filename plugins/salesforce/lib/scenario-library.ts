import { randomUUID } from 'node:crypto';
import { labRecord, labText, parseLabScenario } from './agentforce-lab-contract.js';
import { parsePreviewContext } from './preview-context.js';
import { SCENARIO_LIBRARY_LIMITS as LIMITS, SCENARIO_LIBRARY_RPC, starterScenarios, type SavedScenario } from './scenario-library-contract.js';

interface Kv { get<T>(key: string): Promise<T | null | undefined>; set(key: string, value: unknown): Promise<void> }
interface Database { runScript(sql: string): void; prepare(sql: string): { get(...args: unknown[]): unknown; run(...args: unknown[]): unknown } }
export function scenarioLibraryStorage(database: () => Database): Kv {
  let ready = false;
  const db = () => { const value = database(); if (!ready) { value.runScript('CREATE TABLE IF NOT EXISTS studio_scenarios (project_key TEXT PRIMARY KEY, payload TEXT NOT NULL)'); ready = true; } return value; };
  return {
    async get<T>(key: string) { const row = db().prepare('SELECT payload FROM studio_scenarios WHERE project_key = ?').get(key) as { payload: string } | undefined; if (row && row.payload.length > LIMITS.bytes) throw Error('Scenario storage exceeds its limit.'); return row ? JSON.parse(row.payload) as T : undefined; },
    async set(key, value) { db().prepare('INSERT INTO studio_scenarios (project_key, payload) VALUES (?, ?) ON CONFLICT(project_key) DO UPDATE SET payload = excluded.payload').run(key, JSON.stringify(value)); },
  };
}
export interface ScenarioScope { projectId: string; agentPath: string }
export class ScenarioLibraryError extends Error { constructor(message: string, readonly code = 'invalid_input') { super(message); } }
type Collections = Record<string, SavedScenario[]>;
/** Agent-scoped definitions, bounded per project and serialized before revision checks. */
export class ScenarioLibrary {
  private chains = new Map<string, Promise<unknown>>();
  constructor(private readonly kv: Kv, private readonly now = Date.now, private readonly uuid: () => string = randomUUID) {}
  private async collections(scope: ScenarioScope): Promise<Collections> {
    const raw = await this.kv.get<Collections>(scope.projectId);
    if (raw == null) return {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > LIMITS.agents) throw new ScenarioLibraryError('Scenario storage could not be read. Reload before saving.', 'storage_failed');
    if (Object.values(raw).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0) > LIMITS.perProject || new TextEncoder().encode(JSON.stringify(raw)).length > LIMITS.bytes) throw new ScenarioLibraryError('Scenario storage exceeds its limit.', 'storage_failed');
    for (const rows of Object.values(raw)) {
      if (!Array.isArray(rows) || rows.length > LIMITS.perAgent) throw new ScenarioLibraryError('Scenario storage could not be read.', 'storage_failed');
      const ids = new Set<string>(); const names = new Set<string>();
      for (const row of rows) {
        if (!row || typeof row.id !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(row.id) || !Number.isSafeInteger(row.revision) || row.revision < 1 || !Number.isFinite(row.updatedAt) || ids.has(row.id)) throw new ScenarioLibraryError('Scenario storage could not be read.', 'storage_failed');
        labText(row.name, 'Scenario name', 80); parseLabScenario(row); parsePreviewContext(row.contextVariables);
        if (names.has(row.name.toLocaleLowerCase())) throw new ScenarioLibraryError('Scenario storage contains duplicate names.', 'storage_failed');
        ids.add(row.id); names.add(row.name.toLocaleLowerCase());
      }
    }
    return structuredClone(raw);
  }
  async list(scope: ScenarioScope): Promise<SavedScenario[]> { const all = await this.collections(scope); return structuredClone(Object.hasOwn(all, scope.agentPath) ? all[scope.agentPath] : starterScenarios()); }
  async save(scope: ScenarioScope, input: unknown): Promise<SavedScenario> {
    const row = labRecord(input); const name = labText(row.name, 'Scenario name', 80);
    const { origin: _origin, ...scenario } = parseLabScenario(row);
    const contextVariables = parsePreviewContext(row.contextVariables);
    return this.serial(scope.projectId, async () => {
      const all = await this.collections(scope); const rows = Object.hasOwn(all, scope.agentPath) ? all[scope.agentPath] : starterScenarios();
      const id = typeof row.id === 'string' ? row.id : '';
      const existing = id ? rows.find(saved => saved.id === id) : undefined;
      if (id && !existing) throw new ScenarioLibraryError('This scenario is no longer available. Reload or save a copy.', 'not_found');
      if (existing && row.expectedRevision !== existing.revision) throw new ScenarioLibraryError('This scenario changed in another window. Reload or save a copy.', 'revision_mismatch');
      if (rows.some(saved => saved.id !== id && saved.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new ScenarioLibraryError('A scenario with this name already exists. Choose another name.');
      if (!existing && rows.length >= LIMITS.perAgent) throw new ScenarioLibraryError('An agent supports at most 30 scenarios.', 'limit');
      const saved: SavedScenario = { ...scenario, contextVariables, name, id: existing?.id ?? this.uuid(), revision: (existing?.revision ?? 0) + 1, updatedAt: this.now() };
      all[scope.agentPath] = existing ? rows.map(item => item.id === id ? saved : item) : [...rows, saved];
      await this.write(scope, all); return structuredClone(saved);
    });
  }
  async remove(scope: ScenarioScope, input: unknown): Promise<void> {
    const row = labRecord(input);
    await this.serial(scope.projectId, async () => {
      const all = await this.collections(scope); const rows = Object.hasOwn(all, scope.agentPath) ? all[scope.agentPath] : starterScenarios();
      const existing = rows.find(saved => saved.id === row.id);
      if (!existing) throw new ScenarioLibraryError('This scenario is no longer available. Reload scenarios.', 'not_found');
      if (row.expectedRevision !== existing.revision) throw new ScenarioLibraryError('This scenario changed. Reload before removing it.', 'revision_mismatch');
      all[scope.agentPath] = rows.filter(saved => saved !== existing); await this.write(scope, all);
    });
  }
  private async write(scope: ScenarioScope, all: Collections) {
    if (Object.keys(all).length > LIMITS.agents || Object.values(all).reduce((sum, rows) => sum + rows.length, 0) > LIMITS.perProject || new TextEncoder().encode(JSON.stringify(all)).length > LIMITS.bytes) throw new ScenarioLibraryError('Scenario storage is full for this project. Remove unused scenarios or reduce large variable values.', 'limit');
    await this.kv.set(scope.projectId, all);
  }
  private async serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const next = (this.chains.get(key) ?? Promise.resolve()).catch(() => undefined).then(work); this.chains.set(key, next);
    try { return await next; } finally { if (this.chains.get(key) === next) this.chains.delete(key); }
  }
}
export function registerScenarioLibrary(o: { registerRpc(name: string, handler: (args: unknown) => unknown): void; store: ScenarioLibrary; resolveScope(args: unknown): Promise<ScenarioScope>; changed(scope: ScenarioScope): void }) {
  for (const method of ['list', 'save', 'remove'] as const) o.registerRpc(SCENARIO_LIBRARY_RPC[method], async args => {
    try {
      const scope = await o.resolveScope(args);
      if (method === 'list') return { ok: true, agentPath: scope.agentPath, scenarios: await o.store.list(scope) };
      if (method === 'remove') { await o.store.remove(scope, args); o.changed(scope); return { ok: true }; }
      const scenario = await o.store.save(scope, args); o.changed(scope); return { ok: true, scenario };
    } catch (error) { return { ok: false, code: error instanceof ScenarioLibraryError ? error.code : 'failed', error: (error as Error).message }; }
  });
}
