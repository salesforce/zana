import { describe, expect, it } from 'vitest';
import { composeQuery, formatQuery, parseQuery } from '../src/app/soql/soql-ast.js';
import { soqlCompletions } from '../src/app/soql/soql-completions.js';
import { csvEscape, recordsToCsv, recordsToJson, recordsToTsv } from '../src/app/soql/soql-export.js';
import {
  canRun,
  confirmExport,
  confirmLoadAll,
  emptyOrgMessage,
  orgChip,
  productionBanner
} from '../src/app/soql/soql-explorer-logic.js';
import { insertSnippet, normalizeApiPath, seedQueryForSObject, toggleChildField, toggleField } from '../src/app/soql/soql-field-selection.js';
import { discoverColumns, flattenRecord } from '../src/app/soql/soql-flatten.js';
import { clauseAtCursor, registerSoqlMonacoLanguage } from '../src/app/soql/soql-language.js';

describe('soql ast', () => {
  it('parses, composes, and formats a query with a subquery', () => {
    const soql = 'SELECT Id, Name, (SELECT Id FROM Contacts) FROM Account WHERE Name != null LIMIT 10';
    const ast = parseQuery(soql);
    expect(ast).toMatchObject({ sObject: 'Account' });
    expect(ast?.fields).toEqual([
      { kind: 'field', path: 'Id' },
      { kind: 'field', path: 'Name' },
      { kind: 'subquery', relationshipName: 'Contacts', fields: ['Id'] }
    ]);
    expect(composeQuery(ast!)).toContain('FROM Account');
    expect(formatQuery(soql)).toContain('\nFROM Account');
    expect(formatQuery('not soql')).toBe('not soql');
  });
});

describe('field selection', () => {
  it('toggles fields and namespaced paths', () => {
    expect(normalizeApiPath('ns__Name__c')).toBe('Name__c');
    const seeded = seedQueryForSObject('Contact', '');
    expect(seeded).toBe('SELECT Id FROM Contact');
    const withName = toggleField(seeded, 'Name');
    expect(withName).toContain('Name');
    expect(toggleField(withName, 'Name')).toBe('SELECT Id FROM Contact');
    const withChild = toggleChildField(seeded, 'Cases', 'Id');
    expect(withChild).toContain('(SELECT Id FROM Cases)');
    expect(toggleChildField(withChild, 'Cases', 'Id')).toBe('SELECT Id FROM Contact');
    expect(insertSnippet('SELECT Id', 'Name', 9)).toEqual({ soql: 'SELECT Id, Name', cursor: 15 });
  });
});

describe('flatten and export', () => {
  it('flattens nested relationship objects and exports csv/json/tsv', () => {
    const record = {
      attributes: { type: 'Account' },
      Id: '001',
      Name: 'Acme',
      Owner: { attributes: {}, Name: 'Ada' },
      Contacts: { records: [{ Id: '003' }] }
    };
    const flat = flattenRecord(record);
    expect(flat).toMatchObject({ Id: '001', Name: 'Acme', 'Owner.Name': 'Ada', Contacts: '1 record' });
    expect(discoverColumns([record])).toContain('Owner.Name');
    const csv = recordsToCsv(['Id', 'Name'], [{ Id: '001', Name: 'Acme, Inc' }]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"Acme, Inc"');
    expect(csvEscape('plain')).toBe('plain');
    expect(recordsToJson([{ Id: '1' }])).toContain('"Id"');
    expect(recordsToTsv(['Id'], [{ Id: '1' }])).toContain('1');
  });
});

describe('completions and chrome helpers', () => {
  it('suggests sObjects in FROM and fields in SELECT', () => {
    const catalogs = {
      standard: [{ name: 'Account', label: 'Account', keyPrefix: '001', queryable: true, custom: false, source: 'standard' as const }],
      tooling: []
    };
    const fromItems = soqlCompletions({
      soql: 'SELECT Id FROM Acc',
      cursor: 18,
      catalogs,
      useToolingApi: false
    });
    expect(fromItems.some((item) => item.label === 'Account')).toBe(true);
    const selectItems = soqlCompletions({
      soql: 'SELECT Na FROM Account',
      cursor: 9,
      catalogs,
      useToolingApi: false,
      describe: {
        name: 'Account',
        label: 'Account',
        keyPrefix: '001',
        queryable: true,
        source: 'standard',
        fields: [{ name: 'Name', label: 'Name', type: 'string', relationshipName: null, referenceTo: [], nillable: false, updateable: true, calculated: false, sortable: true, filterable: true, length: 80 }],
        childRelationships: [{ relationshipName: 'Contacts', childSObject: 'Contact', field: 'AccountId', deprecatedAndHidden: false }]
      }
    });
    expect(selectItems.some((item) => item.label === 'Name')).toBe(true);
    expect(clauseAtCursor('SELECT Id FROM Account', 6)).toBe('select');
    const registered: string[] = [];
    registerSoqlMonacoLanguage({
      languages: {
        register: (lang) => registered.push(lang.id),
        setMonarchTokensProvider: () => undefined,
        setLanguageConfiguration: () => undefined
      }
    });
    expect(registered).toEqual(['soql']);
  });

  it('builds empty-org and production banners', () => {
    expect(emptyOrgMessage()).toMatch(/CLI-connected org/);
    expect(productionBanner({ alias: 'prod', kind: 'production' })).toMatch(/production org prod/);
    expect(productionBanner({ alias: 'dev', kind: 'sandbox' })).toBeNull();
    expect(orgChip({ alias: 'dev', kind: 'sandbox' })).toBe('dev (sandbox)');
    expect(canRun('SELECT Id FROM Account', true, false)).toBe(true);
    expect(canRun('', true, false)).toBe(false);
    expect(confirmLoadAll(50, 200, 10000)).toMatch(/50 of 200/);
    expect(confirmExport(3)).toMatch(/3 records/);
    expect(productionBanner({ alias: 'x', kind: 'unknown' })).toMatch(/unknown/);
    expect(orgChip(null, 'fallback')).toBe('fallback');
  });
});
