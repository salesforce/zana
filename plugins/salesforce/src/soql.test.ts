import { describe, expect, it } from 'vitest';
import { applyLimit, inspectSoql, parseSoqlInput } from '../lib/soql.js';

describe('soql plans', () => {
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
