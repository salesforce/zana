export class QueryMoreError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid_cursor' | 'host_mismatch'
  ) {
    super(message);
    this.name = 'QueryMoreError';
  }
}

export interface QueryPage {
  totalSize?: number;
  done?: boolean;
  nextRecordsUrl?: string | null;
  records?: Array<Record<string, unknown>>;
}

export interface PaginationSummary {
  loaded: number;
  total: number;
  hasMore: boolean;
}

/**
 * Turn a Salesforce `nextRecordsUrl` (absolute or `/services/data/vXX.0/query/…`)
 * into a version-relative REST path (`/query/…` or `/tooling/query/…`) that
 * `salesforceRestRequest` can prefix. Rejects other hosts.
 */
export function confineQueryMorePath(instanceUrl: string, nextRecordsUrl: string): string {
  const cursor = nextRecordsUrl.trim();
  if (!cursor) throw new QueryMoreError('queryMore requires nextRecordsUrl.', 'invalid_cursor');

  let parsed: URL;
  try {
    parsed = cursor.startsWith('http://') || cursor.startsWith('https://')
      ? new URL(cursor)
      : new URL(cursor, instanceUrl);
  } catch {
    throw new QueryMoreError('nextRecordsUrl is not a valid URL.', 'invalid_cursor');
  }

  let instance: URL;
  try {
    instance = new URL(instanceUrl);
  } catch {
    throw new QueryMoreError('Org instanceUrl is not a valid URL.', 'invalid_cursor');
  }

  if (parsed.hostname.toLowerCase() !== instance.hostname.toLowerCase()) {
    throw new QueryMoreError('nextRecordsUrl must stay on the connected org host.', 'host_mismatch');
  }

  const stripped = parsed.pathname.replace(/^\/services\/data\/v[\d.]+/i, '');
  if (!stripped || stripped === parsed.pathname) {
    if (/^\/(tooling\/)?query\//i.test(parsed.pathname)) return parsed.pathname;
    throw new QueryMoreError('nextRecordsUrl is not a Salesforce query locator.', 'invalid_cursor');
  }
  if (!/^\/(tooling\/)?query\//i.test(stripped)) {
    throw new QueryMoreError('nextRecordsUrl is not a Salesforce query locator.', 'invalid_cursor');
  }
  return stripped;
}

export function mergeQueryPage(existing: QueryPage | null | undefined, page: QueryPage): QueryPage {
  const existingRecords = existing?.records ?? [];
  const pageRecords = page?.records ?? [];
  return {
    ...existing,
    ...page,
    totalSize: existing?.totalSize ?? page?.totalSize ?? existingRecords.length,
    records: [...existingRecords, ...pageRecords],
    nextRecordsUrl: page?.nextRecordsUrl ?? null,
    done: page?.done ?? !page?.nextRecordsUrl
  };
}

export function getPaginationSummary(data: QueryPage | null | undefined): PaginationSummary {
  const loaded = data?.records?.length ?? 0;
  const total = data?.totalSize ?? loaded;
  const hasMore = Boolean(data?.nextRecordsUrl);
  return { loaded, total, hasMore };
}

export function truncateToCap(page: QueryPage, cap: number): QueryPage {
  const records = page.records ?? [];
  if (records.length <= cap) return page;
  return {
    ...page,
    records: records.slice(0, cap),
    nextRecordsUrl: null,
    done: true
  };
}
