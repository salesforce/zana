import { useCallback, useEffect, useRef, useState } from 'react';
import { callPluginRpc, useRealtime } from '@zana-ai/zcc-plugin-sdk/app';
import { SCENARIOS_CHANGED, SCENARIO_LIBRARY_RPC, type SavedScenario, type ScenarioDefinition } from '../../../lib/scenario-library-contract.js';

export interface ScenarioSelection { scenario: SavedScenario; seq: number }
export interface ScenarioLibraryControls {
  scenarios: SavedScenario[]; loading: boolean; error: string; reload(): void;
  save(definition: ScenarioDefinition, id?: string, expectedRevision?: number): Promise<SavedScenario>;
  remove(scenario: SavedScenario): Promise<void>;
  onManage(): void;
  selection?: ScenarioSelection;
}
export function useScenarioLibrary({ pluginId, projectId, path, enabled = true, call = callPluginRpc }: { pluginId: string; projectId?: string; path: string | null; enabled?: boolean; call?: typeof callPluginRpc }) {
  const key = JSON.stringify([pluginId, projectId, path]);
  const current = useRef(key); current.current = key;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [rows, setRows] = useState<{ key: string; scenarios: SavedScenario[] }>({ key, scenarios: [] });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  const rpc = useCallback(async (method: string, input: Record<string, unknown>) => {
    const reply = await call(pluginId, method, { projectId, agentPath: path, ...input }) as { ok?: boolean; error?: string; scenarios?: SavedScenario[]; scenario?: SavedScenario } | undefined;
    if (!reply?.ok) throw Error(reply?.error || 'Shared scenarios could not be loaded.');
    return reply;
  }, [call, pluginId, projectId, path]);
  useEffect(() => {
    let cancelled = false; setError('');
    if (!enabled || !path || !projectId) { setLoading(false); return; }
    setLoading(true);
    void rpc(SCENARIO_LIBRARY_RPC.list, {}).then(reply => { if (!cancelled) setRows({ key, scenarios: reply.scenarios ?? [] }); })
      .catch(error => { if (!cancelled) setError((error as Error).message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [key, enabled, rpc, revision]);
  useRealtime(SCENARIOS_CHANGED, payload => {
    const row = payload as { projectId?: string; agentPath?: string };
    if (row?.projectId === projectId && row.agentPath === path) reload();
  });
  const save = useCallback(async (definition: ScenarioDefinition, id?: string, expectedRevision?: number) => {
    const target = key;
    const reply = await rpc(SCENARIO_LIBRARY_RPC.save, { ...definition, ...(id ? { id, expectedRevision } : {}) });
    if (!reply.scenario) throw Error('The saved scenario was not returned. Reload before trying again.');
    if (alive.current && current.current === target) {
      const scenario = reply.scenario;
      setRows(previous => {
        const rows = previous.key === target ? previous.scenarios : [];
        return { key: target, scenarios: rows.some(row => row.id === scenario.id) ? rows.map(row => row.id === scenario.id ? scenario : row) : [...rows, scenario] };
      });
    }
    return reply.scenario;
  }, [key, rpc]);
  const remove = useCallback(async (scenario: SavedScenario) => {
    const target = key;
    await rpc(SCENARIO_LIBRARY_RPC.remove, { id: scenario.id, expectedRevision: scenario.revision });
    if (alive.current && current.current === target) setRows(previous => ({ key: target, scenarios: previous.scenarios.filter(row => row.id !== scenario.id) }));
  }, [key, rpc]);
  return { scenarios: rows.key === key ? rows.scenarios : [], loading, error, reload, save, remove };
}
