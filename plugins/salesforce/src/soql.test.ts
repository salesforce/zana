import { describe, expect, it } from 'vitest';
import { isBareCountQuery } from '../lib/soql-count.js';
import { applyLimit, inspectSoql, parseSoqlInput, searchSObjects } from '../lib/soql.js';

describe('soql plans', () => {
  it('bounds schema previews and honors the requested limit', () => {
    for (const [limit, expected] of [[undefined, 25], [5.9, 5], [0, 1], [-5, 1], [300, 25], [NaN, 25], [Infinity, 25]]) {
      expect(parseSoqlInput({ action: 'schema.search', term: 'Account', limit })).toMatchObject({ ok: true, plan: { limit: expected } });
    }
  });

  it('ranks exact names, exact labels and prefixes before substring matches without mutating the catalog', () => {
    const rows = [
      ...Array.from({ length: 30 }, (_, i) => ({ name: `ns__Account_${i}__c`, label: `Namespace Account ${i}` })),
      {}, { name: 'Unrelated' }, { label: 'Account history' },
      { name: 'AccountHistory', label: 'History' },
      { name: 'Customer__c', label: 'Account' },
      { name: 'Account', label: 'Customer' },
    ];
    const before = [...rows];
    expect(searchSObjects(rows, 'ACCOUNT', 5)).toEqual([
      { name: 'Account', label: 'Customer' },
      { name: 'Customer__c', label: 'Account' },
      { name: 'AccountHistory', label: 'History' },
      { name: undefined, label: 'Account history' },
      rows[0],
    ]);
    expect(searchSObjects(rows, 'missing', 25)).toEqual([]);
    expect(rows).toEqual(before);
  });
  it('rejects DML and non-query statements', () => {
    expect(inspectSoql('delete from Account').ok).toBe(false);
    expect(inspectSoql('').ok).toBe(false);
    expect(parseSoqlInput({ action: 'nope' }).ok).toBe(false);
  });

  it('flags ALL ROWS and missing LIMIT as unbounded', () => {
    const allRows = parseSoqlInput({ action: 'query.run', query: 'SELECT Id FROM Account ALL ROWS' });
    expect(allRows).toMatchObject({ ok: true, plan: { allRows: true, envelope: 'soql.unbounded' } });
    const unbounded = parseSoqlInput({ action: 'query.run', query: 'SELECT Id FROM Account' });
    expect(unbounded).toMatchObject({ ok: true, plan: { unbounded: true, envelope: 'soql.unbounded' } });
  });

  it('keeps sample queries bounded and export behind a dedicated envelope', () => {
    const sample = parseSoqlInput({ action: 'query.sample', query: 'SELECT Id FROM Account LIMIT 5' });
    expect(sample).toMatchObject({ ok: true, plan: { unbounded: false, limit: 5 } });
    const exported = parseSoqlInput({ action: 'query.export', query: 'SELECT Id FROM Account LIMIT 5' });
    expect(exported).toMatchObject({ ok: true, plan: { envelope: 'soql.export' } });
    expect(applyLimit('SELECT Id FROM Account', 10)).toBe('SELECT Id FROM Account LIMIT 10');
    expect(applyLimit('SELECT Id FROM Account LIMIT 99;', 10)).toBe('SELECT Id FROM Account LIMIT 10');
    expect(inspectSoql('FIND {Acme} IN NAME FIELDS').ok).toBe(true);
    const clamped = parseSoqlInput({ action: 'query.sample', query: 'SELECT Id FROM Account LIMIT 5', limit: 0 });
    expect(clamped).toMatchObject({ ok: true, plan: { limit: 1 } });
    const over = parseSoqlInput({ action: 'query.run', query: 'SELECT Id FROM Account LIMIT 5', limit: 5000 });
    expect(over).toMatchObject({ ok: true, plan: { envelope: 'soql.unbounded' } });
    const comments = inspectSoql('/* note */ SELECT Id FROM Account -- trailing');
    expect(comments.ok).toBe(true);
  });

  it('requires the fields each action needs', () => {
    expect(parseSoqlInput({ action: 'schema.search' }).ok).toBe(false);
    expect(parseSoqlInput({ action: 'schema.describe' }).ok).toBe(false);
    expect(parseSoqlInput({ action: 'query.validate' }).ok).toBe(false);
    expect(parseSoqlInput({ action: 'schema.search', term: 'Acc' }).ok).toBe(true);
    expect(inspectSoql('INSERT INTO Account').ok).toBe(false);
    const validated = parseSoqlInput({ action: 'query.validate', query: 'SELECT Id FROM Account ALL ROWS' });
    expect(validated).toMatchObject({ ok: true, plan: { allRows: true } });
  });
});

describe('bare COUNT() queries', () => {
  it('runs as written, keeping a LIMIT the query already has', () => {
    expect(applyLimit('SELECT COUNT() FROM Account', 200)).toBe('SELECT COUNT() FROM Account');
    expect(applyLimit('SELECT COUNT() FROM Account;', 200)).toBe('SELECT COUNT() FROM Account');
    expect(applyLimit('SELECT COUNT() FROM Account LIMIT 5;', 200)).toBe('SELECT COUNT() FROM Account LIMIT 5');
    expect(applyLimit('SELECT COUNT() FROM Account LIMIT 5000', 200)).toBe('SELECT COUNT() FROM Account LIMIT 5000');
    expect(applyLimit('select count ( ) from Account where Name != null', 200)).toBe('select count ( ) from Account where Name != null');
  });

  it('still limits every other query', () => {
    expect(applyLimit('SELECT COUNT(Id) FROM Account', 10)).toBe('SELECT COUNT(Id) FROM Account LIMIT 10');
    expect(applyLimit('SELECT Id FROM Account', 10)).toBe('SELECT Id FROM Account LIMIT 10');
  });

  it('treats a sampled bare COUNT() like a run: unbounded unless a LIMIT caps it', () => {
    const plan = (action: string, query: string) => parseSoqlInput({ action, query });
    expect(plan('query.sample', 'SELECT COUNT() FROM Account')).toMatchObject({ ok: true, plan: { unbounded: true, envelope: 'soql.unbounded' } });
    expect(plan('query.sample', 'SELECT COUNT() FROM Account LIMIT 5')).toMatchObject({ ok: true, plan: { unbounded: false } });
    expect(plan('query.sample', 'SELECT COUNT() FROM Account LIMIT 500')).toMatchObject({ ok: true, plan: { unbounded: true } });
    expect(plan('query.sample', 'SELECT Id FROM Account')).toMatchObject({ ok: true, plan: { unbounded: false } });
    expect(plan('query.run', 'SELECT COUNT() FROM Account')).toMatchObject({ ok: true, plan: { unbounded: true } });
  });

  it('keeps the LIMIT written in the query apart from the run limit', () => {
    expect(parseSoqlInput({ action: 'query.run', query: 'SELECT COUNT() FROM Account LIMIT 5', limit: 50 })).toMatchObject({ ok: true, plan: { limit: 50, queryLimit: 5 } });
    expect(parseSoqlInput({ action: 'query.run', query: 'SELECT Id FROM Account' })).toMatchObject({ ok: true, plan: { limit: 200, queryLimit: null } });
    expect(parseSoqlInput({ action: 'schema.search', term: 'Acc' })).toMatchObject({ ok: true, plan: { queryLimit: null } });
  });

  it('detects a bare COUNT() behind full-line comments only', () => {
    expect(isBareCountQuery('-- note\nSELECT COUNT() FROM Account')).toBe(true);
    expect(isBareCountQuery('/* c */ SELECT COUNT() FROM Account')).toBe(false);
    expect(isBareCountQuery('SELECT COUNT(Id) FROM Account')).toBe(false);
    expect(isBareCountQuery('')).toBe(false);
    expect(isBareCountQuery(undefined)).toBe(false);
  });
});
