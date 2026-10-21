import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { indexProjectActions } from '../lib/action-source.js';
import { LIGHTNING_TYPE_LIMITS, componentOverrides, lightningTypeBundlePath, lwcBundlePath, parseComponentRef, parseLightningTypeRef, readLightningType, readLwcBundle, referencedLightningTypes, schemaProperties } from '../lib/lightning-types.js';
import { createNodeDeps } from '../lib/node-deps.js';
import { buildLocalExplorer, registerStudioExplorer } from '../lib/studio-explorer.js';
import type { StudioServerContext } from '../lib/studio-server-context.js';

const dirs: string[] = [];
const TYPES = 'force-app/main/default/lightningTypes';
const LWC = 'force-app/main/default/lwc';
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
    // Past the walk budget, a bundle at the standard path is still found; a file of that name is not a bundle.
    const partial = { ...index, lightningTypes: new Map<string, string[]>(), incomplete: true, probe: indexProjectActions(root, { ...deps, readdir: (p: string) => p.endsWith('force-app') ? Array.from({ length: 6001 }, (_, i) => `f${i}`) : deps.readdir(p) }).probe };
    expect(lightningTypeBundlePath(partial, 'acme__OrderRequest')).toBe(`${TYPES}/OrderRequest`);
    expect(lightningTypeBundlePath(partial, 'acme__Absent')).toBeUndefined();
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

describe('Lightning Type components', () => {
  const deps = createNodeDeps();
  const RENDERER = JSON.stringify({ renderer: { componentOverrides: { $: { definition: 'c/orderCard' }, notes: { definition: 'acme/noteChip' }, bad: { definition: 'Not A Ref' } } } });
  const EDITOR = JSON.stringify({ editor: { componentOverrides: { $: { definition: 'c/orderForm' } } } });
  function withComponents(extra: Record<string, string> = {}) {
    return project({
      [`${TYPES}/OrderRequest/lightningDesktopGenAi/renderer.json`]: RENDERER,
      [`${TYPES}/OrderRequest/lightningDesktopGenAi/editor.json`]: EDITOR,
      [`${LWC}/orderCard/orderCard.js-meta.xml`]: '<meta/>',
      [`${LWC}/orderCard/orderCard.js`]: 'export default class OrderCard {}',
      [`${LWC}/orderCard/orderCard.html`]: '<template></template>',
      [`${LWC}/orderCard/helpers.js`]: 'export const x = 1;',
      [`${LWC}/orderCard/.eslintrc`]: '{}',
      [`${LWC}/orderCard/__tests__/orderCard.test.js`]: 'test',
      ...extra
    });
  }
  it('parses local and namespaced component references only', () => {
    expect(parseComponentRef('c/orderCard')).toEqual({ namespace: 'c', name: 'orderCard' });
    expect(parseComponentRef(' acme/note_chip ')).toEqual({ namespace: 'acme', name: 'note_chip' });
    for (const bad of ['orderCard', 'c/OrderCard', 'c/a/b', '', 'C/x']) expect(parseComponentRef(bad)).toBeNull();
  });
  it('collects every override definition with its role, channel and target', () => {
    expect(componentOverrides(JSON.parse(RENDERER), 'renderer.json', 'lightningDesktopGenAi')).toEqual([
      { ref: 'c/orderCard', namespace: 'c', name: 'orderCard', role: 'renderer', channel: 'lightningDesktopGenAi', target: '$' },
      { ref: 'acme/noteChip', namespace: 'acme', name: 'noteChip', role: 'renderer', channel: 'lightningDesktopGenAi', target: 'notes' }
    ]);
    // Without a role key the file name decides; a non-object config has nothing.
    expect(componentOverrides({ componentOverrides: { $: { definition: 'c/x' } } }, 'editor.json', '')).toEqual([{ ref: 'c/x', namespace: 'c', name: 'x', role: 'editor', channel: '', target: '$' }]);
    for (const value of [null, 'x', [1]]) expect(componentOverrides(value, 'renderer.json', '')).toEqual([]);
    const deep = { renderer: [1, 2, 3, 4, 5, 6, 7, 8, 9].reduce<Record<string, unknown>>(acc => ({ a: acc }), { definition: 'c/deep' }) };
    expect(componentOverrides(deep, 'renderer.json', '')).toEqual([]);
    const many = { renderer: { componentOverrides: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p${i}`, { definition: `c/x${i}` }])) } };
    expect(componentOverrides(many, 'renderer.json', '')).toHaveLength(LIGHTNING_TYPE_LIMITS.components);
  });
  it('resolves components the project owns, by index or the standard-path probe', () => {
    const root = withComponents({ 'sfdx-project.json': JSON.stringify({ namespace: 'acme', packageDirectories: [{ path: 'force-app' }] }) });
    const index = indexProjectActions(root, deps);
    expect(lwcBundlePath(index, 'c/orderCard')).toBe(`${LWC}/orderCard`);
    expect(lwcBundlePath(index, 'acme/orderCard')).toBe(`${LWC}/orderCard`);
    expect(lwcBundlePath(index, 'other/orderCard')).toBeUndefined();
    expect(lwcBundlePath(index, 'nope')).toBeUndefined();
    const partial = { ...index, lwc: new Map<string, string[]>(), incomplete: true, probe: indexProjectActions(root, { ...deps, readdir: (p: string) => p.endsWith('force-app') ? Array.from({ length: 6001 }, (_, i) => `f${i}`) : deps.readdir(p) }).probe };
    expect(lwcBundlePath(partial, 'c/orderCard')).toBe(`${LWC}/orderCard`);
    expect(lwcBundlePath(partial, 'c/absent')).toBeUndefined();
  });
  it('lists the components a type renders and edits with', () => {
    const root = withComponents();
    const view = readLightningType(root, 'c__OrderRequest', deps, indexProjectActions(root, deps));
    expect(view.components).toEqual([
      { ref: 'c/orderForm', namespace: 'c', name: 'orderForm', role: 'editor', channel: 'lightningDesktopGenAi', target: '$' },
      { ref: 'c/orderCard', namespace: 'c', name: 'orderCard', role: 'renderer', channel: 'lightningDesktopGenAi', target: '$', path: `${LWC}/orderCard` },
      { ref: 'acme/noteChip', namespace: 'acme', name: 'noteChip', role: 'renderer', channel: 'lightningDesktopGenAi', target: 'notes' }
    ]);
    // Bad JSON and bundle-root configs: skipped or read with no channel.
    const other = withComponents({ [`${TYPES}/OrderRequest/lightningDesktopGenAi/renderer.json`]: '{nope', [`${TYPES}/OrderRequest/root.json`]: JSON.stringify({ renderer: { componentOverrides: { $: { definition: 'c/rootCard' } } } }) });
    expect(readLightningType(other, 'c__OrderRequest', deps, indexProjectActions(other, deps)).components.map(row => [row.ref, row.channel])).toEqual([['c/orderForm', 'lightningDesktopGenAi'], ['c/rootCard', '']]);
    expect(readLightningType(root, 'lightning__textType', deps, indexProjectActions(root, deps)).components).toEqual([]);
    expect(readLightningType(root, 'c__Ghost', deps, indexProjectActions(root, deps)).components).toEqual([]);
  });
  it('reads a component bundle: markup and controller first, nested folders and dotfiles skipped', () => {
    const root = withComponents();
    const index = indexProjectActions(root, deps);
    const view = readLwcBundle('c/orderCard', deps, index);
    expect(view).toMatchObject({ ref: 'c/orderCard', name: 'orderCard', status: 'ready', path: `${LWC}/orderCard` });
    expect(view.files.map(file => file.path.split('/').pop())).toEqual(['orderCard.html', 'orderCard.js', 'orderCard.js-meta.xml', 'helpers.js']);
    expect(view.files[1]!.content).toContain('OrderCard');
    expect(view.message).toBeUndefined();
  });
  it('explains missing and foreign components, refuses bad refs, and never follows a link out', () => {
    const outside = mkdtempSync(join(tmpdir(), 'sf-lwc-out-')); dirs.push(outside);
    writeFileSync(join(outside, 'secret.js'), 'secret');
    const root = withComponents({ [`${LWC}/empty/.keep`]: '', [`${LWC}/big/big.js`]: 'x'.repeat(LIGHTNING_TYPE_LIMITS.fileBytes + 1) });
    symlinkSync(join(outside, 'secret.js'), join(root, LWC, 'empty', 'leak.js'));
    const index = indexProjectActions(root, deps);
    expect(readLwcBundle('c/ghost', deps, index).message).toContain('LightningComponentBundle:ghost');
    expect(readLwcBundle('acme/noteChip', deps, index)).toMatchObject({ status: 'missing', message: expect.stringContaining('acme package') });
    expect(() => readLwcBundle('Nope', deps, index)).toThrow(/Not a Lightning Web Component/);
    expect(readLwcBundle('c/empty', deps, index)).toMatchObject({ status: 'ready', files: [], message: 'This bundle has no readable files.' });
    expect(readLwcBundle('c/big', deps, index).files).toEqual([{ path: `${LWC}/big/big.js`, content: '', truncated: true }]);
    expect(() => readLwcBundle('c/orderCard', deps, { ...index, lwc: new Map([['orderCard', ['../outside']]]) })).toThrow(/outside this project/);
    const unreadable = readLwcBundle('c/orderCard', { ...deps, readdir: (p: string) => { if (p.endsWith('orderCard')) throw Error('EACCES'); return deps.readdir(p); } }, index);
    expect(unreadable).toMatchObject({ status: 'ready', files: [] });
  });
  it('caps the files a bundle shows', () => {
    const root = withComponents(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`${LWC}/many/f${i}.js`, 'x'])));
    expect(readLwcBundle('c/many', deps, indexProjectActions(root, deps)).files).toHaveLength(LIGHTNING_TYPE_LIMITS.lwcFiles);
  });
  it('adds components to the explorer and to the agents that reach them through a type', () => {
    const nodes = buildLocalExplorer(withComponents(), deps).nodes;
    const by = ['force-app/main/default/aiAuthoringBundles/Orders/Orders.agent'];
    expect(nodes.filter(node => node.kind === 'lwc')).toEqual([
      { kind: 'lwc', apiName: 'acme/noteChip', usedBy: by, via: ['c__OrderRequest'] },
      { kind: 'lwc', apiName: 'c/orderCard', path: `${LWC}/orderCard`, usedBy: by, via: ['c__OrderRequest'] },
      { kind: 'lwc', apiName: 'c/orderForm', usedBy: by, via: ['c__OrderRequest'] }
    ]);
    expect(nodes.find(node => node.kind === 'agent')!.uses!.filter(use => use.kind === 'lwc').map(use => use.apiName)).toEqual(['c/orderForm', 'c/orderCard', 'acme/noteChip']);
  });
  it('skips components when the project cannot be indexed or a type cannot be read', () => {
    const root = withComponents();
    let calls = 0;
    const flaky = { ...deps, realpath: (p: string) => { if (p.endsWith('OrderRequest') && ++calls > 1) throw Error('gone'); return deps.realpath(p); } };
    expect(buildLocalExplorer(root, flaky).nodes.filter(node => node.kind === 'lwc')).toEqual([]);
  });
});

describe('explorer components through .zcc copies', () => {
  it('reads the components of a type only a .zcc copy references, without listing the copy as a user', () => {
    const copy = '.zcc/agent-versions/Orders/Orders.agent';
    const root = project({
      'force-app/main/default/aiAuthoringBundles/Orders/Orders.agent': 'nothing typed here',
      [copy]: AGENT,
      [`${TYPES}/OrderRequest/lightningDesktopGenAi/renderer.json`]: JSON.stringify({ renderer: { componentOverrides: { $: { definition: 'c/orderCard' } } } }),
      [`${LWC}/orderCard/orderCard.js`]: 'x'
    });
    const nodes = buildLocalExplorer(root, createNodeDeps(), copy).nodes;
    expect(nodes.find(node => node.kind === 'lwc')).toEqual({ kind: 'lwc', apiName: 'c/orderCard', path: `${LWC}/orderCard`, usedBy: [], via: ['c__OrderRequest'] });
    expect(nodes.find(node => node.path === copy)!.uses).toContainEqual({ kind: 'lwc', apiName: 'c/orderCard' });
  });
});

describe('studio.lwc RPC', () => {
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
    return (args: unknown) => handlers.get('studio.lwc')!(args) as Promise<any>;
  }
  it('refuses without a project or a ref', async () => {
    expect(await setup('')({ ref: 'c/x' })).toMatchObject({ ok: false, code: 'not_configured' });
    const call = setup(project());
    expect(await call({})).toMatchObject({ ok: false, code: 'invalid_argument' });
    expect(await call({ ref: 'x'.repeat(201) })).toMatchObject({ ok: false, code: 'invalid_argument' });
  });
  it('returns the bundle and reports read failures', async () => {
    const call = setup(project({ [`${LWC}/orderCard/orderCard.js`]: 'x' }));
    expect(await call({ ref: 'c/orderCard' })).toMatchObject({ ok: true, data: { status: 'ready', files: [{ path: `${LWC}/orderCard/orderCard.js` }] } });
    expect(await call({ ref: 'Bad' })).toMatchObject({ ok: false, code: 'lwc_failed', error: 'Not a Lightning Web Component reference.' });
    const broken = setup(project(), { ...createNodeDeps(), realpath: () => { throw 'boom'; } });
    expect(await broken({ ref: 'c/orderCard' })).toMatchObject({ ok: false, code: 'lwc_failed', error: 'The component could not be read.' });
  });
});
