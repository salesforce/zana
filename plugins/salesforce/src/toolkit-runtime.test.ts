import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { toolkitRuntimeLoader } from '../lib/toolkit-runtime.js';
import { AGENT_SCRIPT_EXAMPLES } from '../lib/agent-script-model.js';
import { buildToolkitRuntime } from '../scripts/build-toolkit.mjs';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
it('executes real SDK with packaged assets outside the source tree and reads evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sf-runtime-isolated-')); dirs.push(dir);
  await buildToolkitRuntime(join(dir, 'toolkit-runtime'));
  const workspace = join(dir, 'project'); await mkdir(workspace);
  await writeFile(join(workspace, 'broken.js'), 'import { LightningElement } from "lwc"; export default class Bad extends LightningElement { render( }');
  await writeFile(join(workspace, 'Example.agent'), AGENT_SCRIPT_EXAMPLES[0].source);
  const load = toolkitRuntimeLoader(pathToFileURL(join(dir, 'server.mjs')).href);
  const runtime = await load(); expect(await load()).toBe(runtime);
  const options = { workspace, artifactDir: join(dir, 'evidence'), allowEffects: false, signal: new AbortController().signal, timeoutMs: 60_000 };
  for (const [name, input] of [
    ['sf_flow', { action: 'quality.rules' }], ['code_analyzer', { action: 'recipes' }],
    ['sf_metadata', { action: 'manifest', metadata: [{ type: 'ApexClass', fullName: 'Example' }] }],
    ['sf_lwc', { action: 'file.diagnose', file: 'broken.js' }],
    ['agentscript_authoring', { verb: 'compile', mode: 'check', agent_file: 'Example.agent' }],
    ['data360_discover', { action: 'actions.search', params: { query: 'segment', limit: 5 } }]
  ] as const) {
    const result = await runtime.executeTool(name, input, options);
    if (name === 'sf_lwc') expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ provider: 'lwc-js', severity: 'error' })]));
    else expect(result.error, JSON.stringify(result)).toBeUndefined();
    expect(result.execution?.runId).toBeTruthy();
    expect(await stat(result.execution.resultFile)).toBeTruthy();
    expect(await runtime.readResult(result.execution.resultFile, {})).toBeTruthy();
    const projected = runtime.toModelResult(result, { maxBytes: 24_000 }); expect(JSON.stringify(projected).length).toBeLessThan(25_000);
    if (name === 'sf_metadata') expect(await readFile(result.artifacts[0]?.path ?? result.data.manifest, 'utf8')).toContain('ApexClass');
  }
}, 120_000);
it('retries a missing optional runtime after it is built and supports source module location', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sf-loader-')); dirs.push(dir);
  const loader = toolkitRuntimeLoader(pathToFileURL(join(dir, 'lib', 'runtime.ts')).href);
  await expect(loader()).rejects.toThrow(/missing/);
  await mkdir(join(dir, 'toolkit-runtime')); await writeFile(join(dir, 'toolkit-runtime/sdk.mjs'), 'export const marker = true;');
  expect(await loader()).toMatchObject({ marker: true });
});
