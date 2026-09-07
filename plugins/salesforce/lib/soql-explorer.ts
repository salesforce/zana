import { ConnectionError } from './connection.js';
import { compactError } from './dx-project.js';
import type { SalesforceSdk } from './sdk-contract.js';
import { isAbortError, parseSoqlApiError } from './soql-api-error.js';
import {
  globalCacheKey,
  normalizeSObjectDescribe,
  normalizeSObjectList,
  sobjectCacheKey,
  type SoqlDescribeCatalogs,
  type SoqlSObjectDescribe
} from './soql-describe.js';
import {
  pushRecent,
  readHistory,
  removeItem,
  upsertSaved,
  writeHistoryKind,
  type ExplorerKv,
  type SoqlHistoryItem,
  type SoqlHistoryKind
} from './soql-history.js';
import { QueryMoreError, type QueryPage } from './soql-query-more.js';
import { inspectSoql } from './soql.js';
import { stripSoqlComments } from './strip-soql-comments.js';
import { type PublicOrgView, type SalesforceResponse } from './types.js';

export type ExplorerResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: string; error: string; line?: number; column?: number; errorCode?: string };

function rpcRecord(args: unknown): Record<string, unknown> {
  return args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
}

function rpcString(args: unknown, key: string): string {
  const value = rpcRecord(args)[key];
  return typeof value === 'string' ? value.trim() : '';
}

function rpcBool(args: unknown, key: string): boolean {
  return rpcRecord(args)[key] === true;
}

function fromSObjectName(soql: string): string | undefined {
  const match = soql.match(/\bFROM\s+([A-Za-z][\w]*)/i);
  return match?.[1];
}

export class SoqlExplorer {
  private readonly memory = new Map<string, unknown>();
  private readonly inflight = new Map<string, AbortController>();

  constructor(
    private readonly sdk: Pick<
      SalesforceSdk,
      'connect' | 'request' | 'query' | 'queryMore' | 'describeGlobal' | 'describeSObject' | 'limits'
    >,
    private readonly kv: ExplorerKv,
    private readonly now: () => number = () => Date.now()
  ) {}

  dispose(): void {
    for (const controller of this.inflight.values()) controller.abort();
    this.inflight.clear();
    this.memory.clear();
  }

  abort(args: unknown): ExplorerResult<{ aborted: boolean }> {
    const requestId = rpcString(args, 'requestId');
    if (!requestId) return { ok: false, code: 'invalid_input', error: 'abort requires requestId.' };
    const controller = this.inflight.get(requestId);
    if (!controller) return { ok: true, aborted: false };
    controller.abort();
    this.inflight.delete(requestId);
    return { ok: true, aborted: true };
  }

  async describeGlobal(args: unknown): Promise<ExplorerResult<{ catalogs: SoqlDescribeCatalogs; org: PublicOrgView }>> {
    try {
      const org = await this.sdk.connect();
      const key = globalCacheKey(org.orgId, org.apiVersion);
      const forceRefresh = rpcBool(args, 'forceRefresh');
      if (!forceRefresh) {
        const cached = await this.readCache<SoqlDescribeCatalogs>(key);
        if (cached) return { ok: true, catalogs: cached, org };
      } else {
        this.memory.delete(key);
      }
      const [standardRes, toolingRes] = await Promise.all([
        this.sdk.describeGlobal(),
        this.sdk.describeGlobal({ tooling: true })
      ]);
      if (standardRes.response.status >= 400) {
        return failResponse(standardRes.response);
      }
      const catalogs: SoqlDescribeCatalogs = {
        standard: normalizeSObjectList(standardRes.response.json, 'standard'),
        tooling:
          toolingRes.response.status >= 400
            ? []
            : normalizeSObjectList(toolingRes.response.json, 'tooling')
      };
      await this.writeCache(key, catalogs);
      return { ok: true, catalogs, org: standardRes.org };
    } catch (error) {
      return failCaught(error);
    }
  }

  async describeSObject(args: unknown): Promise<ExplorerResult<{ describe: SoqlSObjectDescribe; org: PublicOrgView }>> {
    const name = rpcString(args, 'sobject') || rpcString(args, 'name');
    if (!name) return { ok: false, code: 'invalid_input', error: 'describeSObject requires sobject.' };
    const useToolingApi = rpcBool(args, 'useToolingApi');
    const forceRefresh = rpcBool(args, 'forceRefresh');
    try {
      const org = await this.sdk.connect();
      const key = sobjectCacheKey(org.orgId, org.apiVersion, name, useToolingApi);
      if (!forceRefresh) {
        const cached = await this.readCache<SoqlSObjectDescribe>(key);
        if (cached) return { ok: true, describe: cached, org };
      } else {
        this.memory.delete(key);
      }
      const { org: fromDescribe, response } = await this.sdk.describeSObject(name, {
        tooling: useToolingApi
      });
      if (response.status >= 400) return failResponse(response);
      const describe = normalizeSObjectDescribe(response.json, useToolingApi ? 'tooling' : 'standard');
      await this.writeCache(key, describe);
      return { ok: true, describe, org: fromDescribe };
    } catch (error) {
      return failCaught(error);
    }
  }

  async query(args: unknown): Promise<ExplorerResult<QuerySuccess>> {
    const soql = rpcString(args, 'soql') || rpcString(args, 'query');
    if (!soql) return { ok: false, code: 'invalid_input', error: 'query requires soql.' };
    const executable = stripSoqlComments(soql);
    const inspection = inspectSoql(executable);
    if (!inspection.ok) return { ok: false, code: 'invalid_input', error: inspection.error };
    const useToolingApi = rpcBool(args, 'useToolingApi');
    const includeDeleted = rpcBool(args, 'includeDeleted');
    const requestId = rpcString(args, 'requestId');
    const signal = this.arm(requestId);
    try {
      const result = await this.sdk.query(executable, {
        tooling: useToolingApi,
        allRows: includeDeleted,
        signal
      });
      if (result.response.status >= 400) return failResponse(result.response);
      const sobjectName = fromSObjectName(executable);
      await this.rememberRecent(result.org.orgId, {
        soql,
        useToolingApi,
        includeDeleted,
        at: this.now()
      });
      return {
        ok: true,
        soql,
        sobjectName,
        useToolingApi,
        includeDeleted,
        org: result.org,
        totalSize: result.totalSize,
        done: result.done,
        nextRecordsUrl: result.nextRecordsUrl,
        records: result.records
      };
    } catch (error) {
      return failCaught(error);
    } finally {
      this.disarm(requestId);
    }
  }

  async queryMore(args: unknown): Promise<ExplorerResult<QuerySuccess>> {
    const nextRecordsUrl = rpcString(args, 'nextRecordsUrl');
    if (!nextRecordsUrl) return { ok: false, code: 'invalid_input', error: 'queryMore requires nextRecordsUrl.' };
    const requestId = rpcString(args, 'requestId');
    const signal = this.arm(requestId);
    try {
      const result = await this.sdk.queryMore(nextRecordsUrl, { signal });
      if (result.response.status >= 400) return failResponse(result.response);
      return {
        ok: true,
        soql: rpcString(args, 'soql'),
        sobjectName: rpcString(args, 'sobjectName') || undefined,
        useToolingApi: rpcBool(args, 'useToolingApi'),
        includeDeleted: rpcBool(args, 'includeDeleted'),
        org: result.org,
        totalSize: result.totalSize,
        done: result.done,
        nextRecordsUrl: result.nextRecordsUrl,
        records: result.records
      };
    } catch (error) {
      return failCaught(error);
    } finally {
      this.disarm(requestId);
    }
  }

  async explain(args: unknown): Promise<ExplorerResult<{ plans: unknown; soql: string; org: PublicOrgView }>> {
    const soql = rpcString(args, 'soql') || rpcString(args, 'query');
    if (!soql) return { ok: false, code: 'invalid_input', error: 'explain requires soql.' };
    const executable = stripSoqlComments(soql);
    const inspection = inspectSoql(executable);
    if (!inspection.ok) return { ok: false, code: 'invalid_input', error: inspection.error };
    const useToolingApi = rpcBool(args, 'useToolingApi');
    try {
      const { org, response } = await this.sdk.request(useToolingApi ? '/tooling/query' : '/query', {
        method: 'GET',
        query: { explain: executable }
      });
      if (response.status >= 400) return failResponse(response);
      return { ok: true, plans: response.json, soql, org };
    } catch (error) {
      return failCaught(error);
    }
  }

  async limits(): Promise<ExplorerResult<{ dailyApiRequests: { max: number; remaining: number } | null; org: PublicOrgView }>> {
    try {
      const { org, response, dailyApiRequests } = await this.sdk.limits();
      if (response.status >= 400) return failResponse(response);
      return { ok: true, org, dailyApiRequests };
    } catch (error) {
      return failCaught(error);
    }
  }

  async historyList(): Promise<ExplorerResult<{ recent: SoqlHistoryItem[]; saved: SoqlHistoryItem[]; org: PublicOrgView }>> {
    try {
      const org = await this.sdk.connect();
      const store = await readHistory(this.kv, org.orgId);
      return { ok: true, org, recent: store.recent, saved: store.saved };
    } catch (error) {
      return failCaught(error);
    }
  }

  async historySave(args: unknown): Promise<ExplorerResult<{ item: SoqlHistoryItem; recent: SoqlHistoryItem[]; saved: SoqlHistoryItem[] }>> {
    const soql = rpcString(args, 'soql');
    if (!soql) return { ok: false, code: 'invalid_input', error: 'save requires soql.' };
    const kind = (rpcString(args, 'kind') || 'saved') as SoqlHistoryKind;
    if (kind !== 'recent' && kind !== 'saved') {
      return { ok: false, code: 'invalid_input', error: 'kind must be recent or saved.' };
    }
    try {
      const org = await this.sdk.connect();
      const store = await readHistory(this.kv, org.orgId);
      const item: SoqlHistoryItem = {
        id: rpcString(args, 'id') || `q-${this.now()}`,
        name: rpcString(args, 'name') || undefined,
        soql,
        useToolingApi: rpcBool(args, 'useToolingApi'),
        includeDeleted: rpcBool(args, 'includeDeleted'),
        at: this.now()
      };
      if (kind === 'recent') {
        const recent = pushRecent(store.recent, item);
        await writeHistoryKind(this.kv, org.orgId, 'recent', recent);
        return { ok: true, item, recent, saved: store.saved };
      }
      const saved = upsertSaved(store.saved, item);
      await writeHistoryKind(this.kv, org.orgId, 'saved', saved);
      return { ok: true, item, recent: store.recent, saved };
    } catch (error) {
      return failCaught(error);
    }
  }

  async historyRemove(args: unknown): Promise<ExplorerResult<{ recent: SoqlHistoryItem[]; saved: SoqlHistoryItem[] }>> {
    const id = rpcString(args, 'id');
    const kind = (rpcString(args, 'kind') || 'saved') as SoqlHistoryKind;
    if (!id) return { ok: false, code: 'invalid_input', error: 'remove requires id.' };
    if (kind !== 'recent' && kind !== 'saved') {
      return { ok: false, code: 'invalid_input', error: 'kind must be recent or saved.' };
    }
    try {
      const org = await this.sdk.connect();
      const store = await readHistory(this.kv, org.orgId);
      if (kind === 'recent') {
        const recent = removeItem(store.recent, id);
        await writeHistoryKind(this.kv, org.orgId, 'recent', recent);
        return { ok: true, recent, saved: store.saved };
      }
      const saved = removeItem(store.saved, id);
      await writeHistoryKind(this.kv, org.orgId, 'saved', saved);
      return { ok: true, recent: store.recent, saved };
    } catch (error) {
      return failCaught(error);
    }
  }

  private arm(requestId: string): AbortSignal | undefined {
    if (!requestId) return undefined;
    this.inflight.get(requestId)?.abort();
    const controller = new AbortController();
    this.inflight.set(requestId, controller);
    return controller.signal;
  }

  private disarm(requestId: string): void {
    if (requestId) this.inflight.delete(requestId);
  }

  private async readCache<T>(key: string): Promise<T | undefined> {
    if (this.memory.has(key)) return this.memory.get(key) as T;
    const stored = await this.kv.get<T>(key);
    if (stored !== undefined) this.memory.set(key, stored);
    return stored;
  }

  private async writeCache(key: string, value: unknown): Promise<void> {
    this.memory.set(key, value);
    await this.kv.set(key, value);
  }

  private async rememberRecent(
    orgId: string,
    item: Omit<SoqlHistoryItem, 'id'>
  ): Promise<void> {
    const store = await readHistory(this.kv, orgId);
    const recent = pushRecent(store.recent, item);
    await writeHistoryKind(this.kv, orgId, 'recent', recent);
  }
}

interface QuerySuccess extends QueryPage {
  soql: string;
  sobjectName?: string;
  useToolingApi: boolean;
  includeDeleted: boolean;
  org: PublicOrgView;
}

function failResponse(response: SalesforceResponse): ExplorerResult<never> {
  const parsed = parseSoqlApiError(response.status, response.json, response.text);
  return {
    ok: false,
    code: parsed.errorCode || 'api_error',
    error: parsed.message || compactError(response.status, response.json, response.text),
    line: parsed.line,
    column: parsed.column,
    errorCode: parsed.errorCode
  };
}

function failCaught(error: unknown): ExplorerResult<never> {
  if (isAbortError(error)) return { ok: false, code: 'aborted', error: 'Query aborted.' };
  if (error instanceof QueryMoreError) return { ok: false, code: error.code, error: error.message };
  if (error instanceof ConnectionError) return { ok: false, code: error.code, error: error.message };
  return { ok: false, code: 'failed', error: error instanceof Error ? error.message : String(error) };
}
