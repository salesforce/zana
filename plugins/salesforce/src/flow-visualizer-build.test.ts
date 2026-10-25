import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
const engine = vi.hoisted(() => ({ visualizeMetadata: vi.fn(), dispose: vi.fn() }));
vi.mock('@salesforce/metadata-visualizer-web', () => ({ createWebVisualizationEngine: vi.fn(async () => engine) }));
import { buildFlowVisualizer } from '../scripts/build-flow-visualizer.mjs';

let root: string;
afterEach(async () => { vi.resetAllMocks(); if (root) await rm(root, { recursive: true, force: true }); });
it('builds both fitted themes with the sandbox policy, Escape relay and license', async () => {
  root = await mkdtemp(join(tmpdir(), 'flow-build-'));
  engine.visualizeMetadata.mockResolvedValue({ bundle: { body: '<html><head></head><body>contentCenterX:E==null?void 0:E.spineCenterX</body></html>' } });
  await buildFlowVisualizer(root);
  for (const theme of ['light', 'dark']) {
    const html = await readFile(join(root, 'flow-visualizer', `${theme}.html`), 'utf8');
    expect(html).toContain('contentCenterX:void 0');
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain('FLOW_PREVIEW_CLOSE');
  }
  expect((await readFile(join(root, 'flow-visualizer/LICENSE.txt'), 'utf8')).length).toBeGreaterThan(100);
  expect(engine.visualizeMetadata.mock.calls).toEqual([['flow', { theme: 'light' }], ['flow', undefined]]);
  expect(engine.dispose).toHaveBeenCalledOnce();
});
it.each([{ error: { message: 'SDK failed' } }, { bundle: null }])('disposes the engine when visualization fails: %o', async result => {
  root = await mkdtemp(join(tmpdir(), 'flow-build-'));
  engine.visualizeMetadata.mockResolvedValue(result);
  await expect(buildFlowVisualizer(root)).rejects.toThrow('error' in result ? result.error.message : 'Flow visualizer bundle is unavailable');
  expect(engine.dispose).toHaveBeenCalledOnce();
});
it('disposes the engine even when output preparation fails', async () => {
  root = await mkdtemp(join(tmpdir(), 'flow-build-'));
  await writeFile(join(root, 'flow-visualizer'), 'not a directory');
  await expect(buildFlowVisualizer(root)).rejects.toThrow();
  expect(engine.dispose).toHaveBeenCalledOnce();
});
