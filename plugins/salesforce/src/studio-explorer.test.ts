import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLocalExplorer, buildLocalExplorerAsync, EXPLORER_LIMITS, referencedTargets, registerStudioExplorer } from '../lib/studio-explorer.js';
import { createNodeDeps } from '../lib/node-deps.js';
import type { StudioServerContext } from '../lib/studio-server-context.js';

const dirs: string[] = [];
const AGENT = `start_agent:\n  actions:\n    a: apex://OrderLookup\n    b: flow://CheckReturn\n    c: generatePromptResponse://Summarize\n    d: apex://Missing\n    e: apex://OrderLookup\n`;
function project(extra: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sf-explorer-')); dirs.push(root);
  const files: Record<string, string> = {
    'sfdx-project.json': JSON.stringify({ packageDirectories: [{ path: 'force-app' }] }),
    'force-app/main/default/aiAuthoringBundles/Support/Support.agent': AGENT,
    'force-app/main/default/aiAuthoringBundles/Other/Other.agent': 'start_agent:\n  x: apex://OrderLookup\n',
    'force-app/main/default/classes/OrderLookup.cls': 'public class OrderLookup {}',
    'force-app/main/default/flows/CheckReturn.flow-meta.xml': '<Flow/>',
    'tests/Support.scenario.json': '{}',
    'tests/notes.txt': 'x',
    ...extra
  };
  for (const [path, content] of Object.entries(files)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); }
  return root;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('referencedTargets', () => {
  it('finds distinct apex, flow and prompt references', () => {
    expect(referencedTargets(AGENT).map(row => `${row.kind}:${row.name}`)).toEqual(['apex:OrderLookup', 'flow:CheckReturn', 'prompt:Summarize', 'apex:Missing']);
    expect(referencedTargets('nothing here')).toEqual([]);
  });
  it('caps the number of targets', () => {
    const source = Array.from({ length: 300 }, (_, i) => `apex://Cls${i}`).join('\n');
    expect(referencedTargets(source)).toHaveLength(EXPLORER_LIMITS.targets);
  });
});

describe('buildLocalExplorer', () => {
  it('cooperative UI discovery preserves focused agents, caps, references and confined paths', async () => {
    const extra = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`agents/A${i}.agent`, `x: apex://Cls${i}`]));
    const root = project(extra), deps = createNodeDeps();
    const outside = mkdtempSync(join(tmpdir(), 'sf-outside-')); dirs.push(outside);
    writeFileSync(join(outside, 'Secret.agent'), 'x: apex://Secret');
    symlinkSync(outside, join(root, 'escape'));
    const focus = 'agents/A49.agent', expand = ['agents/A48.agent', '../Secret.agent'];
    let heartbeat = false;
    const beat = new Promise<void>(resolve => setImmediate(() => { heartbeat = true; resolve(); }));
    const actual = await buildLocalExplorerAsync(root, deps, focus, expand);
    expect(heartbeat).toBe(true);
    await beat;
    expect(actual).toEqual(buildLocalExplorer(root, deps, focus, expand));
    expect(actual.truncated).toBe(true);
    expect(actual.nodes.some(node => node.apiName === 'Secret')).toBe(false);
    expect(actual.nodes.find(node => node.path === focus)?.uses).toEqual([{ kind: 'apex', apiName: 'Cls49' }]);
    expect(await buildLocalExplorerAsync('/definitely/not/here', deps)).toEqual({ nodes: [], truncated: false });
  });
  it('lists agents, resolved targets with usedBy, and scenario suites', () => {
    const result = buildLocalExplorer(project(), createNodeDeps());
    const byKind = (kind: string) => result.nodes.filter(node => node.kind === kind);
    expect(byKind('agent').map(node => node.apiName)).toEqual(['Other', 'Support']);
    // Each scanned agent lists what it references, deduplicated, in source order.
    expect(byKind('agent').find(node => node.apiName === 'Support')!.uses).toEqual([
      { kind: 'apex', apiName: 'OrderLookup' }, { kind: 'flow', apiName: 'CheckReturn' }, { kind: 'prompt', apiName: 'Summarize' }, { kind: 'apex', apiName: 'Missing' }
    ]);
    expect(byKind('agent').find(node => node.apiName === 'Other')!.uses).toEqual([{ kind: 'apex', apiName: 'OrderLookup' }]);
    expect(byKind('apex')).toEqual([
      { kind: 'apex', apiName: 'Missing', usedBy: ['force-app/main/default/aiAuthoringBundles/Support/Support.agent'] },
      { kind: 'apex', apiName: 'OrderLookup', path: 'force-app/main/default/classes/OrderLookup.cls', usedBy: ['force-app/main/default/aiAuthoringBundles/Other/Other.agent', 'force-app/main/default/aiAuthoringBundles/Support/Support.agent'] }
    ]);
    expect(byKind('flow')[0]).toMatchObject({ apiName: 'CheckReturn', path: 'force-app/main/default/flows/CheckReturn.flow-meta.xml' });
    expect(byKind('prompt')).toEqual([{ kind: 'prompt', apiName: 'Summarize', usedBy: ['force-app/main/default/aiAuthoringBundles/Support/Support.agent'] }]);
    expect(byKind('scenario')).toEqual([{ kind: 'scenario', path: 'tests/Support.scenario.json', apiName: 'Support' }]);
    expect(result.truncated).toBe(false);
  });
  it('returns nothing for a missing root and tolerates a missing tests folder', () => {
    expect(buildLocalExplorer('/definitely/not/here', createNodeDeps())).toEqual({ nodes: [], truncated: false });
    const root = mkdtempSync(join(tmpdir(), 'sf-explorer-')); dirs.push(root);
    expect(buildLocalExplorer(root, createNodeDeps())).toEqual({ nodes: [], truncated: false });
  });
  it('does not follow a tests symlink out of the project', () => {
    const outside = mkdtempSync(join(tmpdir(), 'sf-outside-')); dirs.push(outside);
    writeFileSync(join(outside, 'Evil.scenario.json'), '{}');
    const root = mkdtempSync(join(tmpdir(), 'sf-explorer-')); dirs.push(root);
    symlinkSync(outside, join(root, 'tests'));
    expect(buildLocalExplorer(root, createNodeDeps()).nodes.filter(node => node.kind === 'scenario')).toEqual([]);
  });
  it('bounds agents, scanned files and scenarios', () => {
    const extra: Record<string, string> = {};
    for (let i = 0; i < EXPLORER_LIMITS.scanAgents + 5; i++) extra[`agents/A${String(i).padStart(3, '0')}.agent`] = `x: apex://C${i}`;
    for (let i = 0; i < EXPLORER_LIMITS.scenarios + 3; i++) extra[`tests/S${i}.scenario.json`] = '{}';
    const result = buildLocalExplorer(project(extra), createNodeDeps());
    expect(result.truncated).toBe(true);
    expect(result.nodes.filter(node => node.kind === 'scenario')).toHaveLength(EXPLORER_LIMITS.scenarios);
    // Agents past the scan limit carry no `uses`: the UI says they were not indexed instead of showing an empty list.
    const agentRows = result.nodes.filter(node => node.kind === 'agent');
    expect(agentRows.filter(node => node.uses).length).toBe(EXPLORER_LIMITS.scanAgents);
  });
  it('scans the focused agent first, past the scan limit, and ignores a path the listing does not return', () => {
    const extra: Record<string, string> = {};
    for (let i = 0; i < EXPLORER_LIMITS.scanAgents + 5; i++) extra[`agents/A${String(i).padStart(3, '0')}.agent`] = `x: apex://C${i}`;
    const root = project(extra);
    const last = `agents/A${String(EXPLORER_LIMITS.scanAgents + 4).padStart(3, '0')}.agent`;
    const usesOf = (focus?: string) => buildLocalExplorer(root, createNodeDeps(), focus).nodes.find(node => node.kind === 'agent' && node.path === last)?.uses;
    expect(usesOf()).toBeUndefined();
    expect(usesOf(last)).toEqual([{ kind: 'apex', apiName: `C${EXPLORER_LIMITS.scanAgents + 4}` }]);
    expect(usesOf('../outside.agent')).toBeUndefined();
  });
  it('scans unfolded agents after the focus, and the project before its .zcc copies', () => {
    const extra: Record<string, string> = {};
    // `.zcc/` sorts first in the listing; its copies must not take the scan window from the project's own agents.
    for (let i = 0; i < EXPLORER_LIMITS.scanAgents; i++) extra[`.zcc/agent-versions/V${String(i).padStart(3, '0')}.agent`] = `x: apex://Old${i}`;
    for (let i = 0; i < EXPLORER_LIMITS.scanAgents + 5; i++) extra[`agents/A${String(i).padStart(3, '0')}.agent`] = `x: apex://C${i}`;
    const root = project(extra);
    const name = (i: number) => `agents/A${String(i).padStart(3, '0')}.agent`;
    const usesOf = (result: ReturnType<typeof buildLocalExplorer>, path: string) => result.nodes.find(node => node.kind === 'agent' && node.path === path)?.uses;
    const plain = buildLocalExplorer(root, createNodeDeps());
    expect(usesOf(plain, name(0))).toEqual([{ kind: 'apex', apiName: 'C0' }]);
    expect(usesOf(plain, '.zcc/agent-versions/V000.agent')).toBeUndefined();
    const last = name(EXPLORER_LIMITS.scanAgents + 4);
    const other = name(EXPLORER_LIMITS.scanAgents + 3);
    const unfolded = buildLocalExplorer(root, createNodeDeps(), last, [other, '../outside.agent', '']);
    expect(usesOf(unfolded, last)).toEqual([{ kind: 'apex', apiName: `C${EXPLORER_LIMITS.scanAgents + 4}` }]);
    expect(usesOf(unfolded, other)).toEqual([{ kind: 'apex', apiName: `C${EXPLORER_LIMITS.scanAgents + 3}` }]);
    // Only the first `expand` entries count.
    const many = Array.from({ length: EXPLORER_LIMITS.expand }, (_, i) => name(EXPLORER_LIMITS.scanAgents - EXPLORER_LIMITS.expand + i)).concat(last);
    expect(usesOf(buildLocalExplorer(root, createNodeDeps(), '', many), last)).toBeUndefined();
  });
  it('lists what a .zcc copy references without counting it as a user', () => {
    const copy = '.zcc/agent-versions/Support/Support.agent';
    const result = buildLocalExplorer(project({ [copy]: 'x: apex://OrderLookup\ny: flow://OnlyOld\n' }), createNodeDeps(), copy);
    expect(result.nodes.find(node => node.path === copy)!.uses).toEqual([{ kind: 'apex', apiName: 'OrderLookup' }, { kind: 'flow', apiName: 'OnlyOld' }]);
    expect(result.nodes.find(node => node.kind === 'apex' && node.apiName === 'OrderLookup')!.usedBy).not.toContain(copy);
    expect(result.nodes.find(node => node.kind === 'flow' && node.apiName === 'OnlyOld')).toEqual({ kind: 'flow', apiName: 'OnlyOld', usedBy: [] });
  });
  it('locates a target without reading its source', () => {
    const root = project({ 'force-app/main/default/classes/Big.cls': 'x'.repeat(800_000), 'agents/Big.agent': 'x: apex://Big' });
    const deps = createNodeDeps();
    const readFile = vi.spyOn(deps, 'readFile');
    const big = buildLocalExplorer(root, deps).nodes.find(node => node.apiName === 'Big' && node.kind === 'apex');
    // Opening it reports the preview limit; the tree still points at the file.
    expect(big).toEqual({ kind: 'apex', apiName: 'Big', path: 'force-app/main/default/classes/Big.cls', usedBy: ['agents/Big.agent'] });
    expect(readFile.mock.calls.some(([path]) => String(path).endsWith('Big.cls'))).toBe(false);
  });
  it('walks the project once however many targets the agents reference', () => {
    const extra: Record<string, string> = {};
    for (let i = 0; i < 20; i++) extra[`force-app/main/default/classes/C${i}.cls`] = 'public class C {}';
    extra['agents/Many.agent'] = Array.from({ length: 20 }, (_, i) => `a${i}: apex://C${i}`).join('\n');
    const deps = createNodeDeps();
    const readdir = vi.spyOn(deps, 'readdir');
    const nodes = buildLocalExplorer(project(extra), deps).nodes;
    expect(nodes.filter(node => node.kind === 'apex' && /^C\d+$/.test(node.apiName) && node.path)).toHaveLength(20);
    const classDirReads = readdir.mock.calls.filter(([path]) => String(path).endsWith('/classes'));
    // Agent listing plus the one action index; it used to be one walk per target.
    expect(classDirReads).toHaveLength(2);
  });
  it('still lists targets without paths when the project cannot be indexed', () => {
    const deps = createNodeDeps();
    const readFileBounded = deps.readFileBounded!;
    vi.spyOn(deps, 'readFileBounded').mockImplementation((path, max) => {
      if (String(path).endsWith('sfdx-project.json')) throw Error('unreadable');
      return readFileBounded(path, max);
    });
    const lookup = buildLocalExplorer(project(), deps).nodes.find(node => node.apiName === 'OrderLookup');
    expect(lookup).toEqual({ kind: 'apex', apiName: 'OrderLookup', usedBy: expect.any(Array) });
  });
});

describe('studio.explorer RPC', () => {
  function setup(opts: { root?: string; org?: string; execSf?: ReturnType<typeof vi.fn> }) {
    const handlers = new Map<string, (args: unknown) => unknown>();
    const dispose: Array<() => void> = [];
    const deps = { ...createNodeDeps(), execSf: opts.execSf ?? vi.fn() };
    const studio = {
      zcc: { onDispose: (hook: () => void) => dispose.push(hook) },
      registerRpc: (name: string, handler: (args: unknown) => unknown) => handlers.set(name, handler),
      contexts: { current: () => ({ settings: { projectRoot: opts.root ?? '', defaultOrg: opts.org ?? '' } }) },
      sdk: { connect: async () => ({ alias: 'dev', orgId: '00D000000000001' }) },
      deps
    } as unknown as StudioServerContext;
    registerStudioExplorer(studio);
    return { call: (args: unknown = {}) => handlers.get('studio.explorer')!(args) as Promise<any>, dispose, deps };
  }
  it('refuses without a project folder', async () => {
    expect(await setup({}).call()).toMatchObject({ ok: false, code: 'not_configured' });
  });
  it('answers local nodes without an org', async () => {
    const execSf = vi.fn();
    const result = await setup({ root: project(), execSf }).call();
    expect(result.ok).toBe(true);
    expect(result.nodes.some((node: any) => node.kind === 'agent')).toBe(true);
    expect(execSf).not.toHaveBeenCalled();
  });
  it('passes the open agent through as the scan focus', async () => {
    const extra: Record<string, string> = {};
    for (let i = 0; i < EXPLORER_LIMITS.scanAgents + 2; i++) extra[`agents/A${String(i).padStart(3, '0')}.agent`] = `x: flow://F${i}`;
    const last = `agents/A${String(EXPLORER_LIMITS.scanAgents + 1).padStart(3, '0')}.agent`;
    const result = await setup({ root: project(extra) }).call({ focus: last });
    expect(result.nodes.find((node: any) => node.path === last).uses).toEqual([{ kind: 'flow', apiName: `F${EXPLORER_LIMITS.scanAgents + 1}` }]);
  });
  it('passes unfolded agents through, ignoring entries that are not paths', async () => {
    const extra: Record<string, string> = {};
    for (let i = 0; i < EXPLORER_LIMITS.scanAgents + 2; i++) extra[`agents/A${String(i).padStart(3, '0')}.agent`] = `x: flow://F${i}`;
    const last = `agents/A${String(EXPLORER_LIMITS.scanAgents + 1).padStart(3, '0')}.agent`;
    const { call } = setup({ root: project(extra) });
    const usesOf = (result: any) => result.nodes.find((node: any) => node.path === last).uses;
    expect(usesOf(await call({ expand: [7, null, 'x'.repeat(1001), last] }))).toEqual([{ kind: 'flow', apiName: `F${EXPLORER_LIMITS.scanAgents + 1}` }]);
    expect(usesOf(await call({ expand: 'not-a-list' }))).toBeUndefined();
  });
  it('flags an org listing past the explorer cap so the count reads as a floor', async () => {
    const many = JSON.stringify({ status: 0, result: Array.from({ length: EXPLORER_LIMITS.orgAgents + 1 }, (_, i) => ({ fullName: `Bot${i}_v1` })) });
    const result = await setup({ root: project(), org: 'dev', execSf: vi.fn(async () => ({ code: 0, stdout: many, stderr: '' })) }).call();
    expect(result.nodes.filter((node: any) => node.kind === 'org-agent')).toHaveLength(EXPLORER_LIMITS.orgAgents);
    expect(result.orgAgentsTruncated).toBe(true);
    // The count covers the whole org, not the capped rows; the project's own agents are left out.
    const localAgents = result.nodes.filter((node: any) => node.kind === 'agent').length;
    expect(result.orgAgentsNotLocal).toBe(EXPLORER_LIMITS.orgAgents + 1);
    expect(localAgents).toBeGreaterThan(0);
    expect(result.truncated).toBe(true);
  });
  it('adds org agents when an org is selected and degrades when listing fails', async () => {
    const list = JSON.stringify({ status: 0, result: [{ fullName: 'Support_v1', lastModifiedDate: '2025-01-01T00:00:00.000Z' }, { fullName: 'Billing_v2' }] });
    const execSf = vi.fn(async () => ({ code: 0, stdout: list, stderr: '' }));
    const ok = setup({ root: project(), org: 'dev', execSf });
    const result = await ok.call();
    expect(result.orgError).toBeUndefined();
    expect(result.nodes.filter((node: any) => node.kind === 'org-agent').map((node: any) => node.apiName)).toEqual(['Billing', 'Support']);
    expect(result.orgAgentsTruncated).toBe(false);
    // Support is on disk, so only Billing counts.
    expect(result.orgAgentsNotLocal).toBe(1);
    ok.dispose.forEach(hook => hook());
    const failing = setup({ root: project(), org: 'dev', execSf: vi.fn(async () => { throw Error('org offline'); }) });
    const failed = await failing.call();
    expect(failed.ok).toBe(true);
    expect(failed.orgError).toBeTruthy();
    expect(failed.nodes.some((node: any) => node.kind === 'agent')).toBe(true);
  });
});
