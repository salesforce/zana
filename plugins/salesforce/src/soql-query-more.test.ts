import { describe, expect, it } from 'vitest';
import {
  confineQueryMorePath,
  getPaginationSummary,
  mergeQueryPage,
  QueryMoreError,
  truncateToCap
} from '../lib/soql-query-more.js';

const INSTANCE = 'https://foo--dev.sandbox.my.salesforce.com';

describe('confineQueryMorePath', () => {
  it('strips the versioned data prefix from a relative locator', () => {
    expect(confineQueryMorePath(INSTANCE, '/services/data/v62.0/query/01gxx-2000')).toBe('/query/01gxx-2000');
    expect(confineQueryMorePath(INSTANCE, '/services/data/v62.0/tooling/query/abc')).toBe('/tooling/query/abc');
  });

  it('accepts an absolute URL on the org host', () => {
    expect(
      confineQueryMorePath(INSTANCE, `${INSTANCE}/services/data/v62.0/query/01gxx-2000`)
    ).toBe('/query/01gxx-2000');
  });

  it('rejects a different host', () => {
    expect(() => confineQueryMorePath(INSTANCE, 'https://evil.example/services/data/v62.0/query/x')).toThrow(
      QueryMoreError
    );
    try {
      confineQueryMorePath(INSTANCE, 'https://evil.example/services/data/v62.0/query/x');
    } catch (error) {
      expect(error).toMatchObject({ code: 'host_mismatch' });
    }
  });

  it('rejects empty or non-query locators', () => {
    expect(() => confineQueryMorePath(INSTANCE, '')).toThrow(/requires nextRecordsUrl/);
    expect(() => confineQueryMorePath(INSTANCE, '/services/data/v62.0/sobjects')).toThrow(/locator/);
  });
});

describe('asQueryPage', () => {
  it('normalizes records and totals from a REST payload', async () => {
    const { asQueryPage } = await import('../lib/soql-query-more.js');
    expect(asQueryPage({ totalSize: 2, done: false, nextRecordsUrl: '/query/x', records: [{ Id: '1' }] })).toEqual({
      totalSize: 2,
      done: false,
      nextRecordsUrl: '/query/x',
      records: [{ Id: '1' }]
    });
    expect(asQueryPage(null)).toEqual({ totalSize: 0, done: true, nextRecordsUrl: null, records: [] });
  });
});

describe('query page merge', () => {
  it('appends records and keeps the original totalSize', () => {
    const merged = mergeQueryPage(
      { totalSize: 5, done: false, nextRecordsUrl: '/query/a', records: [{ Id: '1' }] },
      { totalSize: 5, done: true, nextRecordsUrl: null, records: [{ Id: '2' }, { Id: '3' }] }
    );
    expect(merged.records?.map((row) => row.Id)).toEqual(['1', '2', '3']);
    expect(merged.totalSize).toBe(5);
    expect(merged.done).toBe(true);
    expect(getPaginationSummary(merged)).toEqual({ loaded: 3, total: 5, hasMore: false });
  });

  it('truncates to a hard cap', () => {
    const page = truncateToCap(
      { records: [{ Id: '1' }, { Id: '2' }, { Id: '3' }], nextRecordsUrl: '/query/x', done: false },
      2
    );
    expect(page.records).toHaveLength(2);
    expect(page.nextRecordsUrl).toBeNull();
    expect(page.done).toBe(true);
  });
});
