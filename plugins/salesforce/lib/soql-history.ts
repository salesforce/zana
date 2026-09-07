import { SOQL_HISTORY_RECENT_CAP } from './types.js';

export type SoqlHistoryKind = 'recent' | 'saved';

export interface SoqlHistoryItem {
  id: string;
  name?: string;
  soql: string;
  useToolingApi: boolean;
  includeDeleted: boolean;
  at: number;
}

export interface SoqlHistoryStore {
  recent: SoqlHistoryItem[];
  saved: SoqlHistoryItem[];
}

export interface ExplorerKv {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export function historyKey(orgId: string, kind: SoqlHistoryKind): string {
  return `soql:history:${orgId}:${kind}`;
}

function asItems(value: unknown): SoqlHistoryItem[] {
  if (!Array.isArray(value)) return [];
  const out: SoqlHistoryItem[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    if (typeof rec.id !== 'string' || typeof rec.soql !== 'string') continue;
    out.push({
      id: rec.id,
      name: typeof rec.name === 'string' ? rec.name : undefined,
      soql: rec.soql,
      useToolingApi: rec.useToolingApi === true,
      includeDeleted: rec.includeDeleted === true,
      at: typeof rec.at === 'number' ? rec.at : 0
    });
  }
  return out;
}

export async function readHistory(kv: ExplorerKv, orgId: string): Promise<SoqlHistoryStore> {
  const [recent, saved] = await Promise.all([
    kv.get<SoqlHistoryItem[]>(historyKey(orgId, 'recent')),
    kv.get<SoqlHistoryItem[]>(historyKey(orgId, 'saved'))
  ]);
  return { recent: asItems(recent), saved: asItems(saved) };
}

export function pushRecent(
  items: SoqlHistoryItem[],
  next: Omit<SoqlHistoryItem, 'id'> & { id?: string },
  cap = SOQL_HISTORY_RECENT_CAP
): SoqlHistoryItem[] {
  const id = next.id ?? `q-${next.at}`;
  const item: SoqlHistoryItem = { ...next, id };
  const rest = items.filter((row) => row.soql !== item.soql || row.useToolingApi !== item.useToolingApi);
  return [item, ...rest].slice(0, cap);
}

export function upsertSaved(items: SoqlHistoryItem[], next: SoqlHistoryItem): SoqlHistoryItem[] {
  const rest = items.filter((row) => row.id !== next.id);
  return [next, ...rest];
}

export function removeItem(items: SoqlHistoryItem[], id: string): SoqlHistoryItem[] {
  return items.filter((row) => row.id !== id);
}

export async function writeHistoryKind(
  kv: ExplorerKv,
  orgId: string,
  kind: SoqlHistoryKind,
  items: SoqlHistoryItem[]
): Promise<void> {
  await kv.set(historyKey(orgId, kind), items);
}
