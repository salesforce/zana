import { describe, expect, it } from 'vitest';
import { classifyAnonymousApex, diagnoseApexSource, parseApexInput } from '../lib/apex.js';

describe('apex plans', () => {
  it('refuses org-wide tests and empty anonymous bodies', () => {
    expect(parseApexInput({ action: 'test.run' }).ok).toBe(false);
    expect(parseApexInput({ action: 'anon.run' }).ok).toBe(false);
    expect(parseApexInput({ action: 'diagnose' }).ok).toBe(false);
    expect(parseApexInput({ action: 'nope' }).ok).toBe(false);
    expect(parseApexInput({ action: 'anon.run', body: 'x'.repeat(9000) }).ok).toBe(false);
    expect(parseApexInput({
      action: 'test.run',
      className: 'WidgetTest',
      methodNames: ['createsRow', 1, '']
    })).toMatchObject({ ok: true, plan: { methodNames: ['createsRow'] } });
  });

  it('treats allow_mutation as intent and classifies mutation-like tokens', () => {
    const plan = parseApexInput({
      action: 'anon.run',
      body: 'insert new Account(Name = \'X\');',
      allow_mutation: true
    });
    expect(plan).toMatchObject({
      ok: true,
      plan: { allowMutation: true, mutationLikely: true }
    });
    expect(classifyAnonymousApex('System.debug(\'hi\');')).toBe(false);
  });

  it('extracts class name and @isTest methods from source', () => {
    const source = `
      @IsTest
      private class WidgetTest {
        @isTest static void createsRow() {}
        static void helper() {}
      }
    `;
    expect(diagnoseApexSource(source)).toMatchObject({
      className: 'WidgetTest',
      testMethods: ['createsRow']
    });
  });
});
