import { describe, expect, it } from 'vitest';
import { createWebVisualizationEngine } from '@salesforce/metadata-visualizer-web';
import { flowSnapshotFileSystem } from '../lib/flow-visualizer-filesystem.js';
import { flowSnapshotXml, visualizeFlowSnapshot } from '../lib/flow-visualizer.js';
import type { ActionSource } from '../lib/action-source.js';
import { ACTION_FLOW_XML } from './action-fixtures.js';
import { VISUALIZER_FLOW } from './flow-visualizer-fixtures.js';

const source = (patch: Partial<ActionSource> = {}): ActionSource => ({ origin: 'project', target: 'flow://CheckReturn', status: 'ready', label: 'Check return', content: ACTION_FLOW_XML, ...patch });

describe('official Flow visualization', () => {
  it('parses actual local XML with decisions, faults, resources and escaped labels', async () => {
    const result = await visualizeFlowSnapshot(source());
    const data = result.data as any;
    expect(result.fileName).toBe('CheckReturn.flow-meta.xml');
    expect(data.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'Eligible', kind: 'decision' }), expect.objectContaining({ id: 'CreateReturn', kind: 'subflow' })]));
    expect(data.edges).toContainEqual(expect.objectContaining({ from: 'FindOrder', to: 'LogError', isFault: true }));
    expect(data.variables).toContainEqual(expect.objectContaining({ name: 'orderId', isInput: true }));
    expect(JSON.stringify(result)).not.toContain('platformContext');
  });
  it('parses org JSON through the same SDK, including loops and scheduled paths', async () => {
    const data = (await visualizeFlowSnapshot(source({ origin: 'org', flow: VISUALIZER_FLOW }))).data as any;
    expect(data.nodes).toContainEqual(expect.objectContaining({ id: 'Items', kind: 'loop' }));
    expect(data.edges).toContainEqual(expect.objectContaining({ from: 'UpdateLine', to: 'Items' }));
    expect(data.edges.filter((e: any) => e.from === 'FLOW_START')).toHaveLength(3);
    expect(data.edges.some((e: any) => /Async|commit/i.test(e.label ?? ''))).toBe(true);
    expect(data.edges.some((e: any) => /Tomorrow/i.test(e.label ?? ''))).toBe(true);
  });
  it('escapes metadata values without mutating org snapshots or interpreting XML', async () => {
    const flow = { ...VISUALIZER_FLOW, label: '<script>alert(1)</script> & "Hi"', description: null };
    const before = JSON.stringify(flow);
    const xml = flowSnapshotXml(source({ flow }));
    expect(xml).toContain('&lt;script&gt;');
    expect(xml).not.toContain('<description>');
    expect((await visualizeFlowSnapshot(source({ flow }))).data).toMatchObject({ label: flow.label });
    expect(JSON.stringify(flow)).toBe(before);
  });
  it.each(['<Flow>', '<Wrong/>', '<!DOCTYPE Flow><Flow/>', '<!ENTITY a "x"><Flow/>', '', '<Flow><x>'.repeat(42) + '</x></Flow>'.repeat(42)])('rejects malformed or unsafe XML: %s', async content => {
    await expect(visualizeFlowSnapshot(source({ content }))).rejects.toThrow();
  });
  it('bounds XML bytes, element counts, model size and object depth', async () => {
    expect(() => flowSnapshotXml(source({ content: `<Flow><label>${'é'.repeat(375_000)}</label></Flow>` }))).toThrow('750 KB');
    expect(() => flowSnapshotXml(source({ content: `<Flow>${'<x/>'.repeat(25_000)}</Flow>` }))).toThrow('too many');
    let nested: any = {}; for (let i = 0; i < 42; i++) nested = { nested };
    expect(() => flowSnapshotXml(source({ flow: nested }))).toThrow('deeply');
    expect(() => flowSnapshotXml(source({ flow: { 'bad:key': true } }))).toThrow('metadata key');
    await expect(visualizeFlowSnapshot(source({ flow: { assignments: Array.from({ length: 501 }, (_, i) => ({ name: `Step${i}`, label: `Step ${i}` })) } }))).rejects.toThrow('too large');
  });
  it('rejects non-Flow and unavailable sources', async () => {
    await expect(visualizeFlowSnapshot(source({ target: 'apex://CheckReturn' }))).rejects.toThrow('available Flow');
    await expect(visualizeFlowSnapshot(source({ status: 'missing' }))).rejects.toThrow('available Flow');
  });
  it('ships a self-contained renderer with no project data in either theme', async () => {
    const engine = await createWebVisualizationEngine({ fileSystem: flowSnapshotFileSystem('PRIVATE_METADATA') });
    try {
      expect(engine.getPlugin('CheckReturn.flow-meta.xml')?.id).toBe('flow');
      for (const theme of [undefined, 'light'] as const) {
        const bundle = await engine.visualizeMetadata('flow', theme ? { theme } : undefined);
        expect(bundle.error).toBeNull();
        expect(bundle.bundle?.body).toContain('REQUEST_PLUGIN_DATA');
        expect(bundle.bundle?.body).not.toContain('PRIVATE_METADATA');
        expect(bundle.bundle?.body).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
      }
    } finally { engine.dispose(); }
  });
});

describe('single snapshot filesystem', () => {
  it('only exposes its exact in-memory file and denies disk reads, scans and writes', async () => {
    const fs = flowSnapshotFileSystem('secret', 'Sample.flow-meta.xml');
    const file = '/flow-preview/Sample.flow-meta.xml';
    expect(await fs.readFile(file)).toEqual({ success: true, data: 'secret' });
    expect(await fs.readFile('/flow-preview/../.sf/auth.json')).toMatchObject({ success: false });
    expect(await fs.writeFile(file, 'change')).toMatchObject({ success: false });
    expect(await fs.exists(file)).toBe(true);
    expect(await fs.exists('/etc/passwd')).toBe(false);
    expect(await fs.getMetadata(file)).toMatchObject({ success: true, data: { fileName: 'Sample.flow-meta.xml' } });
    expect(await fs.getMetadata('/etc/passwd')).toMatchObject({ success: false });
    expect(await fs.readDirectory('/flow-preview')).toMatchObject({ success: true, data: [{ name: 'Sample.flow-meta.xml', isFile: true }] });
    expect(await fs.readDirectory('/')).toMatchObject({ success: false });
    expect(await fs.findFiles('**/*')).toEqual({ success: true, data: [] });
    expect(fs.getWorkspaceRoot()).toBe('/flow-preview');
    expect(() => flowSnapshotFileSystem('', '../Bad.flow-meta.xml')).toThrow('filename');
  });
});
