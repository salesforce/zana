import { mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { test as base, expect } from './fixtures/app.js';

// Real built-Electron RPC → plugin → CLI boundary, with isolated auth and folders.
const test = base.extend({
  launchEnv: async ({ home }, use) => {
    const bin = join(home, 'sf-bin');
    mkdirSync(bin, { recursive: true });
    mkdirSync(join(home, 'projects'));
    writeFileSync(join(bin, 'sf'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const home = process.env.HOME;
fs.appendFileSync(path.join(home, 'sf-create-trace.jsonl'), JSON.stringify({ args, home, cwd:process.cwd() }) + '\\n');
let result = {};
const value = flag => args[args.indexOf(flag) + 1];
if (args[0] === 'org' && args[1] === 'login') {
  if (value('--alias') === 'fail-login') { console.log(JSON.stringify({status:1,message:'Cancelled'})); process.exit(1); }
  result = { username:'dev@example.com', accessToken:'PRIVATE_LOGIN_TOKEN' };
} else if (args[0] === 'org' && args[1] === 'list') {
  result = { nonScratchOrgs: Array.from({length:180}, (_, i) => ({ alias:i ? 'org-' + i : 'dev', username:i ? 'user' + i + '@example.com' : 'dev@example.com', orgId:'00D' + String(i).padStart(12,'0'), instanceUrl:'https://example.my.salesforce.com', connectedStatus:'Connected', accessToken:'PRIVATE_LIST_TOKEN', isSandbox:true })) };
} else if (args[0] === 'project' && args[1] === 'generate') {
  const folder = path.join(value('--output-dir'), value('--name'));
  if (fs.existsSync(folder)) throw Error('Project generated twice');
  fs.mkdirSync(path.join(folder, 'force-app', 'main', 'default'), {recursive:true});
  fs.writeFileSync(path.join(folder, 'sfdx-project.json'), JSON.stringify({packageDirectories:[{path:'force-app',default:true}],sourceApiVersion:'62.0'}));
  result = { outputDir:folder };
} else if (args[0] === 'config' && args[1] === 'set') {
  if (fs.existsSync(path.join(home, 'fail-config'))) { console.log(JSON.stringify({status:1,message:'Permission denied'})); process.exit(1); }
  if (args.includes('--global') || !fs.existsSync('sfdx-project.json')) throw Error('Wrong config scope');
  fs.mkdirSync('.sf', {recursive:true});
  fs.writeFileSync('.sf/config.json', JSON.stringify({'target-org':args[2].slice('target-org='.length)}));
  result = [{name:'target-org',value:args[2].slice('target-org='.length),success:true}];
} else if (args.includes('display')) {
  result = { alias:'dev',username:'dev@example.com',orgId:'00D000000000000',instanceUrl:'https://example.my.salesforce.com',accessToken:'PRIVATE_DISPLAY_TOKEN',isSandbox:true };
} else if (args[0] === '--version') { console.log('@salesforce/cli/2.0.0'); process.exit(0); }
console.log(JSON.stringify({status:0,result}));
`, { mode: 0o700 });
    await use({ PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` });
  },
});
test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true } });
test.setTimeout(150_000);

test('Salesforce project creation logs in before creating a connected DX project and safely retries', async ({ app, home }, testInfo) => {
  const page = app.window;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') console.error('[renderer]', message.text());
  });
  expect(await page.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'salesforce' }))).toMatchObject({ ok: true });
  await expect.poll(() => page.evaluate(async () => (await window.cc.pluginApps.list()).find(row => row.id === 'salesforce')?.status), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  await page.evaluate(() => { history.pushState({}, '', '/projects'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.getByRole('button', { name: 'Add project', exact: true }).click();
  await page.getByRole('button', { name: 'Salesforce project', exact: true }).click();
  const wizard = page.getByTestId('salesforce-create-project');
  await expect(wizard).toBeVisible();
  await expect(wizard.getByLabel('Project name', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('salesforce-create-login.png') });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.setViewportSize({ width: 720, height: 900 });
  expect(await wizard.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('salesforce-create-login-light.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await wizard.getByRole('radio', { name: 'Sandbox', exact: true }).check();
  await wizard.getByLabel('Org alias', { exact: true }).fill('fail-login');
  await wizard.getByRole('button', { name: 'Log in to Salesforce', exact: true }).click();
  await expect(wizard.getByRole('alert')).toContainText('Sign-in did not finish');
  const trace = () => readFileSync(join(home, 'sf-create-trace.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(trace().some(row => row.args[0] === 'project')).toBe(false);
  await wizard.getByLabel('Org alias', { exact: true }).fill('dev');
  await wizard.getByRole('button', { name: 'Log in to Salesforce', exact: true }).click();
  await expect(wizard.getByLabel('Project name', { exact: true })).toHaveValue('dev');
  await wizard.getByLabel('Project name', { exact: true }).fill('Acme');
  await wizard.getByLabel('Parent folder', { exact: true }).fill(join(home, 'projects'));
  expect(existsSync(join(home, 'projects/Acme'))).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('salesforce-create-folder.png') });
  writeFileSync(join(home, 'fail-config'), 'fail once');
  await wizard.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(wizard.getByRole('alert')).toContainText('Could not set');
  expect(existsSync(join(home, 'projects/Acme/sfdx-project.json'))).toBe(true);
  rmSync(join(home, 'fail-config'));
  await wizard.getByRole('button', { name: 'Finish setup', exact: true }).click();
  await expect(wizard).toHaveCount(0);
  const projects = await page.evaluate(() => window.cc.projects.list());
  const project = projects.find(row => row.path === realpathSync(join(home, 'projects/Acme')));
  expect(project).toBeTruthy();
  expect(project!.icon).toBe('Cloud');
  await page.getByRole('button', { name: 'Back to all projects', exact: true }).click();
  const projectRow = page.locator('.project-item').filter({ hasText: 'Acme' });
  await expect(projectRow.locator('[data-project-icon="Cloud"] svg')).toBeVisible();
  await expect(page.locator('.project-dot--home').first()).toBeVisible();
  await page.getByRole('button', { name: 'Project actions for Acme', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Use Cloud icon', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: testInfo.outputPath('project-icon-picker.png') });
  await page.getByRole('button', { name: 'Use Rocket icon', exact: true }).click();
  await expect(projectRow.locator('[data-project-icon="Rocket"] svg')).toBeVisible();
  await page.reload();
  await expect(projectRow.locator('[data-project-icon="Rocket"] svg')).toBeVisible();
  await page.getByRole('button', { name: 'Project actions for Acme', exact: true }).click();
  await page.getByRole('button', { name: 'Use Circle icon', exact: true }).click();
  await expect(projectRow.locator('[data-project-icon]')).toHaveCount(0);
  // Also cover the desktop IPC → runtime mutation path, independently of HTTP.
  expect(await page.evaluate(id => window.cc.projects.update(id, { icon: 'Cloud' }), project!.id)).toMatchObject({ icon: 'Cloud' });
  await expect(projectRow.locator('[data-project-icon="Cloud"] svg')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('salesforce-project-cloud.png') });
  const status = await page.evaluate(projectId => window.cc.pluginApps.callRpc('salesforce', 'status', { projectId }), project!.id);
  expect(status).toMatchObject({ defaultOrg: 'dev', targetSource: 'project', dxProject: true });
  expect(JSON.stringify(status)).not.toContain('PRIVATE_');
  expect(JSON.parse(readFileSync(join(home, 'projects/Acme/.sf/config.json'), 'utf8'))).toEqual({ 'target-org': 'dev' });
  const commands = trace();
  expect(commands.filter(row => row.args[0] === 'project')).toHaveLength(1);
  expect(commands.filter(row => row.args[0] === 'config')).toHaveLength(2);
  for (const command of commands.filter(row => row.args[0] === 'config')) {
    expect(command).toMatchObject({ home, cwd: realpathSync(join(home, 'projects/Acme')) });
    expect(command.args).toEqual(['config', 'set', 'target-org=dev', '--json']);
  }
  expect(commands.find(row => row.args[1] === 'login').args).toEqual(['org', 'login', 'web', '--json', '--instance-url', 'https://test.salesforce.com', '--alias', 'fail-login']);
  expect(errors).toEqual([]);
});
