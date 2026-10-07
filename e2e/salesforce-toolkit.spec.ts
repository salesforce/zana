import { mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, readdirSync, realpathSync } from 'node:fs';
import { join, delimiter, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from './fixtures/app.js';
import { preparePluginRuntime } from '../packages/plugin-build/src/prepare-plugin-runtime.js';
import { AGENT_SCRIPT_EXAMPLES } from '../plugins/salesforce/lib/agent-script-model.js';

const test = base.extend({
  launchEnv: async ({ home }, use) => {
    const source = process.env.ZCC_E2E_APP_ROOT ?? fileURLToPath(new URL('../', import.meta.url));
    const bundle = join(home, 'runtime-plugins'); mkdirSync(bundle);
    // Keep normal boot providers; Salesforce itself is a compiled release tree.
    for (const id of ['provider-codex', 'provider-claude-code', 'provider-acp', 'provider-pi']) cpSync(join(source, 'plugins', id), join(bundle, id), { recursive: true, filter: p => !p.split(sep).includes('node_modules') });
    await preparePluginRuntime(join(source, 'plugins/salesforce'), join(bundle, 'salesforce'), '2.3.1');
    expect(existsSync(join(bundle, 'salesforce/server.ts'))).toBe(false);
    expect(existsSync(join(bundle, 'salesforce/node_modules'))).toBe(false);
    expect(existsSync(join(bundle, 'salesforce/toolkit-runtime/sdk.mjs'))).toBe(true);
    const project = join(home, 'dx'); mkdirSync(project);
    writeFileSync(join(project, 'sfdx-project.json'), '{"packageDirectories":[],"sourceApiVersion":"63.0"}');
    writeFileSync(join(project, 'broken.js'), 'import { LightningElement } from "lwc"; export default class Bad extends LightningElement { render( }');
    writeFileSync(join(project, 'Example.agent'), AGENT_SCRIPT_EXAMPLES[0].source);
    const bin = join(home, 'bin'); mkdirSync(bin);
    writeFileSync(join(home, 'sf-mode'), 'success');
    writeFileSync(join(bin, 'sf'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SF_TOOLKIT_TRACE, JSON.stringify({ args, cwd:process.cwd(), home:process.env.HOME }) + '\\n');
const mode = fs.readFileSync(process.env.SF_TOOLKIT_MODE, 'utf8');
if(args[0] === 'plugins') {
  if(mode === 'failure') { console.error('Fixture plugin missing'); process.exitCode=1; }
  else if(mode === 'timeout') setTimeout(()=>console.log('too late'),20000);
  else console.log(JSON.stringify([{ padding:'Realistic plugin metadata '.repeat(1600), version:'9.8.7-tail' }]));
} else if(args[0] === '--version') console.log('@salesforce/cli/2.fixture');
else console.log(JSON.stringify({ result:{ nonScratchOrgs:[] } }));
`, { mode: 0o700 });
    writeFileSync(join(bin, 'java'), `#!${process.execPath}\nconsole.error('Fixture Java 21');`, { mode: 0o700 });
    writeFileSync(join(bin, 'python3'), `#!${process.execPath}\nprocess.exitCode=1;`, { mode: 0o700 });
    writeFileSync(join(bin, 'python'), `#!${process.execPath}\nconsole.log('Fixture Python fallback');`, { mode: 0o700 });
    await use({ ZCC_FAKE_PROVIDER: '1', ZCC_BUNDLED_PLUGINS_DIR: bundle, ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD:'0', NODE_PATH:'', PATH:`${bin}${delimiter}${process.env.PATH ?? ''}`, SF_TOOLKIT_TRACE:join(home,'sf-toolkit-trace.jsonl'), SF_TOOLKIT_MODE:join(home,'sf-mode') });
  }
});
test.use({ e2e:true, initialConfig:{ sponsorPromptDismissed:true } });
test.setTimeout(240_000);
test('Salesforce toolkit: compiled SDK, realistic CLI capture, isolated context and removable providers', async ({ app, home }) => {
  const win = app.window;
  expect(await win.evaluate(() => window.cc.extensions.install({ kind:'bundled', id:'salesforce' }))).toMatchObject({ ok:true });
  const trust = win.getByRole('button', { name:'Install with full trust' }); if(await trust.isVisible().catch(()=>false)) await trust.click();
  await expect.poll(()=>win.evaluate(async () => (await window.cc.pluginApps.list()).find(p=>p.id==='salesforce')?.status), { timeout:30_000 }).toMatch(/running|needs-configuration/);
  const projectId = await win.evaluate(async path => { const r=await window.cc.projects.add(path); if(!r.ok) throw Error(r.message); return r.value.id; },join(home,'dx'));
  const invoke = (tool:string,input:unknown) => win.evaluate(({ projectId,tool,input }) => window.cc.pluginApps.callRpc('salesforce','toolkit.run',{ projectId,action:'call',tool,input }), { projectId,tool,input }) as Promise<any>;
  const catalog:any = await win.evaluate(()=>window.cc.pluginApps.callRpc('salesforce','toolkit.run',{ action:'list' })); expect(catalog.tools).toHaveLength(21);
  const flow = await invoke('sf_flow',{ action:'quality.rules' }); expect(flow,JSON.stringify(flow)).toMatchObject({ ok:true, execution:{ runId:expect.any(String) } });
  expect(Object.keys(flow.execution)).toEqual(['runId']);
  const evidence:any = await win.evaluate(({ projectId,runId })=>window.cc.pluginApps.callRpc('salesforce','toolkit.run',{ projectId,action:'result.read',runId }),{ projectId,runId:flow.execution.runId }); expect(evidence,JSON.stringify(evidence)).not.toMatchObject({ ok:false });
  const manifest = await invoke('sf_metadata',{ action:'manifest',metadata:[{ type:'ApexClass',fullName:'Example' }] }); expect(manifest,JSON.stringify(manifest)).toMatchObject({ ok:true }); expect(manifest.data.xml).toContain('ApexClass');
  const lwc = await invoke('sf_lwc',{ action:'file.diagnose',file:'broken.js' }); expect(lwc,JSON.stringify(lwc)).toMatchObject({ tool:'sf_lwc' }); expect(lwc.diagnostics.length).toBeGreaterThan(0);
  const agent = await invoke('agentscript_authoring',{ verb:'compile',mode:'check',agent_file:'Example.agent' }); expect(agent,JSON.stringify(agent)).toMatchObject({ ok:true,data:{ clean:true,compiled_via:'local' } });
  const doctor = await invoke('code_analyzer',{ action:'doctor' }); expect(doctor,JSON.stringify(doctor)).toMatchObject({ ok:true }); expect(doctor.data.doctor.plugin.version).toBe('9.8.7-tail'); expect(doctor.data.doctor.python.detail).toMatch(/Python/);
  const trace = readFileSync(join(home,'sf-toolkit-trace.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line)); expect(trace.find(r=>r.args[0]==='plugins')).toMatchObject({ cwd:realpathSync(join(home,'dx')), home });
  expect(await invoke('sf_lwc',{ action:'file.diagnose',file:'../outside.html' })).toMatchObject({ ok:false });
  expect(await invoke('sf_soql',{ action:'query.run',target_org:'other' })).toMatchObject({ ok:false });
  expect(await invoke('sf_flow',{ action:'fix.apply',file:'broken.js' })).toMatchObject({ code:'refused' });
  writeFileSync(join(home,'sf-mode'),'failure'); const failed = await invoke('code_analyzer',{ action:'doctor' }); expect(failed.data.doctor.plugin).toMatchObject({ ok:false, detail:expect.stringContaining('Fixture plugin missing') });
  writeFileSync(join(home,'sf-mode'),'timeout'); const timed = await invoke('code_analyzer',{ action:'doctor' }); expect(timed.ok).toBe(false);
  writeFileSync(join(home,'sf-mode'),'success');
  // Drive the host's generated settings UI, then prove stale calls stop.
  await win.getByTestId('nav-extensions').click(); await win.getByTestId('extensions-nav-installed').click(); await win.getByRole('button', { name:'Salesforce plugin details' }).click();
  const selector = win.getByLabel('Agent tool provider', { exact:true }); await expect(selector).toBeVisible();
  const probeCount = () => readFileSync(join(home,'sf-toolkit-trace.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line)).filter(r=>r.args[0]==='plugins').length;
  const before = probeCount(); writeFileSync(join(home,'sf-mode'),'timeout');
  const active = invoke('code_analyzer',{ action:'doctor' });
  await expect.poll(probeCount).toBeGreaterThan(before);
  await selector.selectOption('builtin'); expect(await active).toMatchObject({ code:'interrupted' });
  writeFileSync(join(home,'sf-mode'),'success');
  await expect.poll(()=>win.evaluate(()=>window.cc.pluginApps.getSettings('salesforce'))).toMatchObject({ values:{ toolProvider:'builtin' } });
  expect(await invoke('sf_flow',{ action:'quality.rules' })).toMatchObject({ code:'provider_disabled' });
  await selector.selectOption('toolkit'); expect(await invoke('sf_flow',{ action:'quality.rules' })).toMatchObject({ ok:true });
  await selector.selectOption('both');
  expect(await win.evaluate(()=>window.cc.pluginApps.reload('salesforce'))).toMatchObject({ ok:true });
  await expect.poll(()=>invoke('sf_flow',{ action:'quality.rules' })).toMatchObject({ ok:true });
  expect(await win.evaluate(({ projectId,runId })=>window.cc.pluginApps.callRpc('salesforce','toolkit.run',{ projectId,action:'result.read',runId }),{ projectId,runId:flow.execution.runId })).toMatchObject({ code:'scope_mismatch' });
  const files = readdirSync(join(home,'runtime-plugins/salesforce')); expect(files).not.toContain('lib'); expect(files).not.toContain('node_modules');
});
