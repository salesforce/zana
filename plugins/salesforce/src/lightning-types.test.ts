import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { indexProjectActions } from '../lib/action-source.js';
import { LIGHTNING_TYPE_LIMITS, lightningTypeBundlePath, parseLightningTypeRef, readLightningType, referencedLightningTypes, schemaProperties } from '../lib/lightning-types.js';
import { createNodeDeps } from '../lib/node-deps.js';
import { buildLocalExplorer, registerStudioExplorer } from '../lib/studio-explorer.js';
import type { StudioServerContext } from '../lib/studio-server-context.js';

const dirs: string[] = [];
const TYPES = 'force-app/main/default/lightningTypes';
const AGENT = [
  'subagent orders:',
  '  actions:',
  '    lookup:',
  '      target: "apex://OrderLookup"',
  '      inputs:',
  '        order: object',
  '          complex_data_type_name: "c__OrderRequest"',
  '        text: object',
  '          complex_data_type_name: "lightning__textType"',
  '        cls: object',
  '          complex_data_type_name: "@apexClassType/c__Req"',
  '      outputs:',
  '        result: object',
  "          complex_data_type_name: 'ns__Remote' # managed",
  '        missing: object',
  '          complex_data_type_name: c__Ghost',
  ''
].join('\n');
const SCHEMA = JSON.stringify({
  title: 'Order request', description: 'What the agent sends.', type: 'object', required: ['orderId'],
  properties: { orderId: { title: 'Order', 'lightning:type': 'lightning__textType', description: 'Order number' }, notes: { type: ['string', 'null'] }, ref: { $ref: '#/x' }, bare: 7 }
});
function project(extra: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sf-ltypes-')); dirs.push(root);
  const files: Record<string, string> = {
    'sfdx-project.json': JSON.stringify({ packageDirectories: [{ path: 'force-app' }] }),
    'force-app/main/default/aiAuthoringBundles/Orders/Orders.agent': AGENT,
    [`${TYPES}/OrderRequest/schema.json`]: SCHEMA,
    [`${TYPES}/OrderRequest/lightningDesktopGenAi/renderer.json`]: '{"renderer":{"componentOverrides":{}}}',
    [`${TYPES}/OrderRequest/lightningDesktopGenAi/editor.json`]: '{"editor":{}}',
    [`${TYPES}/OrderRequest/lightningDesktopGenAi/readme.txt`]: 'ignored',
    [`${TYPES}/Unused/schema.json`]: '{"title":"Unused","properties":{}}',
    ...extra
  };
  for (const [path, content] of Object.entries(files)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); }
  return root;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('Lightning Type references', () => {
  it('classifies standard, local and namespaced references and rejects Apex class types', () => {
    expect(parseLightningTypeRef('lightning__textType')).toEqual({ ref: 'lightning__textType', standard: true, namespace: 'lightning', bundle: 'textType' });
    expect(parseLightningTypeRef('c__Order')).toEqual({ ref: 'c__Order', standard: false, bundle: 'Order' });
    expect(parseLightningTypeRef('Order')).toEqual({ ref: 'Order', standard: false, bundle: 'Order' });
    expect(parseLightningTypeRef('ns__Order')).toEqual({ ref: 'ns__Order', standard: false, namespace: 'ns', bundle: 'Order' });
    for (const bad of ['@apexClassType/c__Req', 'a__b__c', '', '9x', 'x y']) expect(parseLightningTypeRef(bad)).toBeNull();
  });
  it('finds distinct declared types in quoted, single-quoted and bare forms', () => {
    expect(referencedLightningTypes(AGENT)).toEqual(['c__OrderRequest', 'lightning__textType', 'ns__Remote', 'c__Ghost']);
    expect(referencedLightningTypes(`${AGENT}\n${AGENT}`)).toHaveLength(4);
    expect(referencedLightningTypes('nothing')).toEqual([]);
  });
  it('caps the number of references', () => {
    const source = Array.from({ length: 200 }, (_, i) => `complex_data_type_name: "c__T${i}"`).join('\n');
    expect(referencedLightningTypes(source)).toHaveLength(LIGHTNING_TYPE_LIMITS.refs);
  });
});

describe('schemaProperties', () => {
  it('reads titles, required flags and the best available type', () => {
    expect(schemaProperties(JSON.parse(SCHEMA))).toEqual({
      title: 'Order request', description: 'What the agent sends.',
      properties: [
        { name: 'orderId', required: true, type: 'lightning__textType', title: 'Order', description: 'Order number' },
        { name: 'notes', required: false, type: 'string | null' },
        { name: 'ref', required: false, type: '#/x' },
        { name: 'bare', required: false }
      ]
    });
  });
  it('tolerates non-object schemas', () => {
    for (const value of [null, 3, 'x', []]) expect(schemaProperties(value)).toEqual({ properties: [] });
    expect(schemaProperties({ properties: [], required: 'x' })).toEqual({ properties: [] });
  });
});

describe('readLightningType', () => {
  const deps = createNodeDeps();
  it('reads a project bundle: schema first, then channel JSON', () => {
    const root = project();
    const view = readLightningType(root, 'c__OrderRequest', deps, indexProjectActions(root, deps));
    expect(view).toMatchObject({ ref: 'c__OrderRequest', standard: false, status: 'ready', path: `${TYPES}/OrderRequest`, title: 'Order request' });
    expect(view.files.map(file => file.path)).toEqual([`${TYPES}/OrderRequest/schema.json`, `${TYPES}/OrderRequest/lightningDesktopGenAi/editor.json`, `${TYPES}/OrderRequest/lightningDesktopGenAi/renderer.json`]);
    expect(view.properties).toHaveLength(4);
    expect(view.message).toBeUndefined();
  });
  it('explains standard, missing and foreign-package types', () => {
    const root = project();
    const index = indexProjectActions(root, deps);
    expect(readLightningType(root, 'lightning__textType', deps, index)).toMatchObject({ status: 'standard', standard: true, files: [] });
    expect(readLightningType(root, 'c__Ghost', deps, index).message).toContain('LightningTypeBundle:Ghost');
    expect(readLightningType(root, 'ns__Remote', deps, index).message).toContain('ns package');
    expect(() => readLightningType(root, '@apexClassType/c__Req', deps, index)).toThrow(/Not a Lightning Type/);
  });
  it('resolves the project namespace and reports bad or absent schemas', () => {
    const root = project({
      'sfdx-project.json': JSON.stringify({ namespace: 'acme', packageDirectories: [{ path: 'force-app' }] }),
      [`${TYPES}/Broken/schema.json`]: '{nope',
      [`${TYPES}/NoSchema/lightningDesktopGenAi/renderer.json`]: '{}'
    });
    const index = indexProjectActions(root, deps);
    expect(lightningTypeBundlePath(index, 'acme__OrderRequest')).toBe(`${TYPES}/OrderRequest`);
    expect(lightningTypeBundlePath(index, 'lightning__textType')).toBeUndefined();
    expect(readLightningType(root, 'c__Broken', deps, index).message).toBe('schema.json is not valid JSON.');
    expect(readLightningType(root, 'c__NoSchema', deps, index)).toMatchObject({ status: 'ready', message: 'This bundle has no readable schema.json.' });
  });
  it('lists oversized files without content and never follows a link out of the bundle', () => {
    const outside = mkdtempSync(join(tmpdir(), 'sf-ltypes-out-')); dirs.push(outside);
    writeFileSync(join(outside, 'secret.json'), '{"secret":true}');
    const root = project({ [`${TYPES}/Big/schema.json`]: `{"title":"${'x'.repeat(LIGHTNING_TYPE_LIMITS.fileBytes + 10)}"}` });
    symlinkSync(join(outside, 'secret.json'), join(root, TYPES, 'Big', 'leak.json'));
    const view = readLightningType(root, 'c__Big', deps, indexProjectActions(root, deps));
    expect(view.files).toHaveLength(1);
    expect(view.files[0]).toEqual({ path: `${TYPES}/Big/schema.json`, content: '', truncated: true });
    expect(view.message).toBe('This bundle has no readable schema.json.');
  });
});

describe('explorer Lightning Types', () => {
  it('lists referenced types with usedBy plus unreferenced project bundles', () => {
    const nodes = buildLocalExplorer(project(), createNodeDeps()).nodes.filter(node => node.kind === 'lightning-type');
    const by = ['force-app/main/default/aiAuthoringBundles/Orders/Orders.agent'];
    expect(nodes).toEqual([
      { kind: 'lightning-type', apiName: 'c__Ghost', usedBy: by },
      { kind: 'lightning-type', apiName: 'c__OrderRequest', path: `${TYPES}/OrderRequest`, usedBy: by },
      { kind: 'lightning-type', apiName: 'c__Unused', path: `${TYPES}/Unused` },
      { kind: 'lightning-type', apiName: 'lightning__textType', usedBy: by },
      { kind: 'lightning-type', apiName: 'ns__Remote', usedBy: by }
    ]);
  });
});

describe('studio.lightningType RPC', () => {
  function setup(root: string, deps = createNodeDeps()) {
    const handlers = new Map<string, (args: unknown) => unknown>();
    const studio = {
      zcc: { onDispose: () => undefined },
      registerRpc: (name: string, handler: (args: unknown) => unknown) => handlers.set(name, handler),
      contexts: { current: () => ({ settings: { projectRoot: root, defaultOrg: '' } }) },
      sdk: { connect: vi.fn() },
      deps: { ...deps, execSf: vi.fn() }
    } as unknown as StudioServerContext;
    registerStudioExplorer(studio);
    return (args: unknown) => handlers.get('studio.lightningType')!(args) as Promise<any>;
  }
  it('refuses without a project or a ref', async () => {
    expect(await setup('')({ ref: 'c__X' })).toMatchObject({ ok: false, code: 'not_configured' });
    const call = setup(project());
    expect(await call({})).toMatchObject({ ok: false, code: 'invalid_argument' });
    expect(await call({ ref: 'x'.repeat(201) })).toMatchObject({ ok: false, code: 'invalid_argument' });
  });
  it('returns the bundle and reports read failures', async () => {
    const call = setup(project());
    expect(await call({ ref: 'c__OrderRequest' })).toMatchObject({ ok: true, data: { status: 'ready', title: 'Order request' } });
    expect(await call({ ref: '@apexClassType/c__Req' })).toMatchObject({ ok: false, code: 'lightning_type_failed', error: 'Not a Lightning Type reference.' });
    const broken = setup(project(), { ...createNodeDeps(), realpath: () => { throw 'boom'; } });
    expect(await broken({ ref: 'c__OrderRequest' })).toMatchObject({ ok: false, code: 'lightning_type_failed', error: 'The Lightning Type could not be read.' });
  });
});
