import { createServer } from "node:http";
import { mkdirSync, writeFileSync, readFileSync, realpathSync } from "node:fs";
import { join, delimiter } from "node:path";
import { test as base, expect } from "./fixtures/app.js";
import type { Page } from "@playwright/test";
import { makeFakeGenericHoldBinary } from "./sdk/harness.js";

// Exercise the installed plugin, real child process capture and REST-to-renderer
// path with large deterministic payloads. No Salesforce credentials or model spend.
const test = base.extend({
  launchEnv: async ({ home }, use) => {
    let logReads = 0;
    const server = createServer((req, res) => {
      const url = new URL(req.url!, "http://localhost");
      if (url.pathname.includes('/tooling/sobjects/ApexLog/') && url.pathname.endsWith('/Body')) {
        res.setHeader('content-type', 'text/plain');
        res.end('10:00:00 USER_DEBUG [42] | Order lookup started\n' + '10:00:01 METHOD_ENTRY | OrderService.lookup\n'.repeat(700) + '10:00:02 EXCEPTION_THROWN [71] | Missing order number\n10:00:03 EXECUTION_FINISHED');
        return;
      }
      let data: unknown = {};
      if (url.pathname.endsWith("/sobjects"))
        data = {
          sobjects: [{ name: "Account", label: "Account", queryable: true }],
        };
      else if (url.pathname.endsWith("/describe"))
        data = {
          name: "Account",
          label: "Account",
          fields: [
            { name: "Id", label: "ID", type: "id" },
            { name: "Name", label: "Name", type: "string" },
          ],
          childRelationships: [],
        };
      else if (url.pathname.endsWith("/limits"))
        data = { DailyApiRequests: { Max: 15000, Remaining: 14000 } };
      else if (url.pathname.includes('/query') && url.searchParams.get('q')?.includes('FROM ApexLog'))
        data = { records: ++logReads === 1 ? [] : [{ Id: '07L000000000001', Operation: 'Refresh proof', Status: 'Success', StartTime: 'Today' }] };
      else if (url.pathname.includes("/query"))
        data = {
          records: Array.from({ length: 160 }, (_, i) => ({
            attributes: { type: "Account" },
            Id: `001${String(i).padStart(12, "0")}`,
            Name: `Customer ${i}`,
            Description: "Realistic record payload ".repeat(9),
          })),
          totalSize: 160,
          done: true,
        };
      else if (url.pathname.includes("/sobjects/Account/"))
        data = {
          Id: "001000000000000",
          Name: "Customer 0",
          Description: "Inspected through the Salesforce service",
        };
      else if (url.pathname.includes("runTestsSynchronous"))
        data = {
          numTestsRun: 2,
          numFailures: 1,
          successes: [{ name: "OneTest", methodName: "works", time: 12 }],
          failures: [
            {
              name: "OneTest",
              methodName: "saves",
              message: "Expected 2 records, got 1",
              stackTrace: "Class.OneTest.saves: line 18, column 1",
              time: 8,
            },
          ],
        };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(data));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as { port: number };
    const bin = join(home, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "sf"),
      `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SF_E2E_TRACE, JSON.stringify({ args, cwd: process.cwd(), home: process.env.HOME }) + '\\n');
const alias = args[args.indexOf('--target-org') + 1] || 'dev';
const org = { alias, username: alias + '@example.com', orgId: '00D000000000001', instanceUrl: process.env.SF_E2E_URL, isSandbox: alias !== 'org-158', isScratchOrg: false, isScratch: false, accessToken: 'FAKE_PRIVATE_TOKEN', apiVersion: '62.0' };
const authFile = process.env.SF_E2E_TRACE + '.auth.json';
if (args[0] === 'org' && args[1] === 'login') {
  const loginAlias = args[args.indexOf('--alias') + 1];
  if (loginAlias === 'fail-login') { console.error('FAKE_PRIVATE_TOKEN'); process.exitCode = 1; return; }
  const connected = { ...org, alias: loginAlias, username: loginAlias + '@example.com', isDefaultUsername: false };
  fs.writeFileSync(authFile, JSON.stringify(connected));
  setTimeout(() => console.log(JSON.stringify({ status:0, result:{ padding:'x'.repeat(24000), ...connected, refreshToken:'FAKE_REFRESH_TOKEN' } })), loginAlias === 'browser-dev' ? 21_000 : 800);
  return;
}
let result = {};
if (args[0] === '--version') { console.log('@salesforce/cli/2.fixture'); process.exit(0); }
if (args.includes('display')) result = org;
else if (args[0] === 'org' && args[1] === 'list' && args[2] === 'metadata') {
  if (args.includes('Flow')) { console.log(JSON.stringify({ status:1, message:'Fixture metadata denied' })); process.exitCode = 1; return; }
  result = Array.from({length:180}, (_, i) => ({ fullName:'Class' + i, type:'ApexClass', fileName:'classes/' + 'x'.repeat(120) + i + '.cls' }));
} else if (args[0] === 'org' && args[1] === 'list') result = { nonScratchOrgs: [...Array.from({length:160}, (_, i) => ({...org, alias:i === 0 ? 'dev' : 'org-' + i, username: 'developer' + i + '@example.com', isSandbox:i !== 158, isDefaultUsername:i === 0 })), ...(fs.existsSync(authFile) ? [JSON.parse(fs.readFileSync(authFile, 'utf8'))] : [])] };
else if (args[0] === 'project') result = args.includes('--async') ? {id:'0Af000000000001'} : args.includes('report') ? {
  done:true, success:false, status:'Failed', numberComponentsDeployed:0, numberComponentsTotal:2, numberComponentErrors:1,
  details:{componentFailures:[{componentType:'ApexClass', fullName:'Class0', fileName:'classes/Class0.cls', lineNumber:7, columnNumber:3, problem:'Variable does not exist: invoice'}]}
} : {toDeploy:[{type:'ApexClass', fullName:'Class0', projectRelativePath:'force-app/main/default/classes/Class0.cls', conflict:false, ignored:false, operation:'deploy'}], conflicts:[{type:'ApexClass', fullName:'Class1', projectRelativePath:'force-app/main/default/classes/Class1.cls', conflict:true, ignored:false}], ignored:[], toDelete:[], toRetrieve:[]};
if (args.includes('report')) process.exitCode = 1;
console.log(JSON.stringify({status:process.exitCode || 0, result}));
`,
      { mode: 0o700 },
    );
    const project = join(home, "dx");
    mkdirSync(join(project, "force-app"), { recursive: true });
    writeFileSync(
      join(project, "sfdx-project.json"),
      JSON.stringify({
        packageDirectories: [{ path: "force-app", default: true }],
        sourceApiVersion: "62.0",
      }),
    );
    try {
      await use({
        ZCC_FAKE_PROVIDER: "1",
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        SF_E2E_URL: `http://127.0.0.1:${address.port}`,
        SF_E2E_TRACE: join(home, "sf-trace.jsonl"),
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
});
test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true } });
test.setTimeout(180_000);

async function route(window: Page, path: string) {
  await window.evaluate((path) => {
    history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

test("Salesforce workbench: real plugin, project targeting, data, operations and native panels", async ({
  app,
  home,
}, testInfo) => {
  const window = app.window;
  const rendererErrors: string[] = [];
  window.on("pageerror", (error) => rendererErrors.push(error.message));
  const installed = await window.evaluate(() =>
    window.cc.extensions.install({ kind: "bundled", id: "salesforce" }),
  );
  expect(installed).toMatchObject({ ok: true });
  const trust = window.getByRole("button", { name: "Install with full trust" });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect
    .poll(
      () =>
        window.evaluate(
          async () =>
            (await window.cc.pluginApps.list()).find(
              (row) => row.id === "salesforce",
            )?.status,
        ),
      { timeout: 30_000 },
    )
    .toMatch(/running|needs-configuration/);
  const projectId = await window.evaluate(
    async (path) => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw Error(result.message);
      return result.value.id;
    },
    join(home, "dx"),
  );
  await window.evaluate(() =>
    window.cc.pluginApps.setSettings("salesforce", { defaultOrg: "dev" }),
  );
  const roster = (await window.evaluate(() =>
    window.cc.pluginApps.callRpc("salesforce", "orgs"),
  )) as { orgs: unknown[] };
  expect(roster.orgs).toHaveLength(160);
  expect(JSON.stringify(roster)).not.toContain("FAKE_PRIVATE_TOKEN");
  await route(window, `/projects/${projectId}`);
  await window
    .getByRole("navigation", { name: "dx navigation" })
    .getByRole("button", { name: "Salesforce", exact: true })
    .click();
  const workbench = window.getByTestId("salesforce-workbench");
  await expect(workbench).toBeVisible();
  await expect(window.getByRole("navigation", { name: "dx navigation" }).getByRole("button", { name: "SOQL", exact: true })).toHaveCount(0);
  await expect(workbench.getByRole("tab")).toHaveCount(5);
  await workbench.getByTestId("salesforce-org-picker").selectOption("org-159");
  await expect(workbench.getByTestId("salesforce-org-picker")).toHaveValue("org-159");
  await expect(workbench.locator(".sf-summary")).toContainText("Project target");
  expect(
    await window.evaluate(() => window.cc.pluginApps.getSettings("salesforce")),
  ).toMatchObject({ values: { defaultOrg: "dev" } });
  // The native top layer must contain focus and restore it on Escape. The
  // header action opens only connection setup, without expanding the org list.
  const connectButton = workbench.locator('.sf-workbench-toolbar').getByRole('button', { name: 'Connect org', exact: true });
  await connectButton.click();
  const connectionDialog = workbench.getByRole('dialog', { name: 'Connect an org' });
  await expect(connectionDialog).toBeVisible();
  await expect(workbench.getByTestId('salesforce-org-list')).toHaveCount(0);
  await expect(connectionDialog.getByRole('radio', { name: 'Production', exact: true })).toBeFocused();
  for (let tab = 0; tab < 9; tab++) {
    await window.keyboard.press('Tab');
    expect(await connectionDialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await window.keyboard.press('Escape');
  await expect(connectionDialog).toHaveCount(0);
  await expect(connectButton).toBeFocused();
  await connectButton.click();
  for (const theme of ['light', 'dark']) {
    await window.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await window.screenshot({ path: testInfo.outputPath(`salesforce-connect-${theme}.png`), animations: 'disabled' });
    const colors = await connectionDialog.getByRole('button', { name: 'Sign in with browser' }).evaluate(el => ({
      fg: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor,
    }));
    expect(colors.fg).toBe('rgb(255, 255, 255)');
    expect(colors.bg).not.toBe(colors.fg);
  }
  await window.setViewportSize({ width: 480, height: 700 });
  await connectionDialog.getByRole('radio', { name: 'My Domain', exact: true }).check();
  await expect(connectionDialog.getByRole('button', { name: 'Sign in with browser' })).toBeInViewport();
  expect(await connectionDialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await window.screenshot({ path: testInfo.outputPath('salesforce-connect-narrow.png') });
  await window.setViewportSize({ width: 1440, height: 900 });
  await connectionDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  // Browser authentication travels through the real plugin RPC and sf child.
  // The identity is deliberately beyond 24 KiB of output, after potential secrets.
  for (const [instance, loginAlias, expectedUrl] of [
    ['production', 'browser-dev', 'https://login.salesforce.com'],
    ['sandbox', 'browser-sandbox', 'https://test.salesforce.com'],
    ['custom', 'browser-sso', 'https://company.my.salesforce.com'],
  ]) {
    await workbench.locator('.sf-workbench-toolbar').getByRole('button', { name: 'Connect org', exact: true }).click();
    const form = workbench.getByTestId('salesforce-org-login');
    await expect(form).toBeVisible();
    await form.getByRole('radio', { name: instance === 'production' ? 'Production' : instance === 'sandbox' ? 'Sandbox' : 'My Domain', exact: true }).check();
    if (instance === 'custom') await form.getByLabel('My Domain URL').fill('company.my.salesforce.com');
    await form.getByLabel('Org alias').fill(loginAlias);
    await expect(form.getByRole('button', { name: 'Sign in with browser' })).toBeInViewport();
    if (instance === 'custom') await window.screenshot({ path: testInfo.outputPath('salesforce-my-domain-login.png') });
    await form.getByRole('button', { name: 'Sign in with browser' }).click();
    await expect(form.getByRole('button', { name: 'Waiting for sign-in…' })).toBeDisabled();
    if (instance === 'production') {
      await window.screenshot({ path: testInfo.outputPath('salesforce-connect-waiting.png') });
      await form.getByRole('button', { name: 'Close', exact: true }).click();
      await connectButton.click();
      await expect(form.getByRole('button', { name: 'Waiting for sign-in…' })).toBeDisabled();
    }
    await expect(workbench.locator('.sf-org-switcher-name')).toHaveText(loginAlias, { timeout: 35_000 });
    await expect(workbench.getByTestId('salesforce-org-picker')).toHaveValue(loginAlias);
    await expect(workbench.getByRole('status')).toContainText('selected it for this project');
    const loginTrace = readFileSync(join(home, 'sf-trace.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)).find(row => row.args.includes(loginAlias));
    expect(loginTrace).toMatchObject({ home, cwd: realpathSync(join(home, 'dx')) });
    expect(loginTrace.args).toEqual(['org', 'login', 'web', '--json', '--instance-url', expectedUrl, '--alias', loginAlias]);
    await expect(workbench.getByRole('dialog')).toHaveCount(0);
  }
  expect(await window.evaluate(() => window.cc.pluginApps.getSettings('salesforce'))).toMatchObject({ values: { defaultOrg: 'dev' } });
  await workbench.locator('.sf-workbench-toolbar').getByRole('button', { name: 'Connect org', exact: true }).click();
  await workbench.getByLabel('Org alias').fill('fail-login');
  await workbench.getByRole('button', { name: 'Sign in with browser' }).click();
  await expect(workbench.getByRole('alert')).toContainText('Sign-in did not finish');
  await expect(workbench.getByTestId('salesforce-org-picker')).toHaveValue('browser-sso');
  await expect(workbench).not.toContainText('FAKE_PRIVATE_TOKEN');
  const postLogin = await window.evaluate((projectId) => window.cc.pluginApps.callRpc('salesforce', 'orgs', { projectId }), projectId);
  expect(JSON.stringify(postLogin)).not.toMatch(/FAKE_PRIVATE_TOKEN|FAKE_REFRESH_TOKEN/);
  await window.screenshot({ path: testInfo.outputPath('salesforce-login.png') });
  await workbench.getByRole('button', { name: 'Cancel', exact: true }).click();
  await workbench.getByTestId('salesforce-org-picker').selectOption('org-159');
  await expect(workbench.getByTestId('salesforce-org-picker')).toHaveValue('org-159');
  await workbench.getByRole("tab", { name: "Data", exact: true }).click();
  await window.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  expect(await workbench.getByTestId('soql-run').evaluate(el => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
  await window.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await workbench
    .getByTestId("soql-editor")
    .fill("SELECT Id, Name, Description FROM Account LIMIT 200");
  await workbench.getByTestId("soql-run").click();
  await expect(workbench.getByTestId("soql-results")).toContainText(
    "Customer 159",
  );
  const queryDivider = workbench.getByRole('separator', { name: 'Resize query editor' });
  await queryDivider.focus();
  await window.keyboard.press('ArrowDown');
  await expect(queryDivider).toHaveAttribute('aria-valuenow', '204');
  await queryDivider.dblclick();
  await expect(queryDivider).toHaveAttribute('aria-valuenow', '180');
  await expect(workbench.getByLabel('Export results')).toBeEnabled();
  await workbench
    .getByRole("button", { name: "Customer 0", exact: true })
    .click();
  await expect(workbench.locator(".sf-soql-record")).toContainText("Read only");
  await window.screenshot({ path: testInfo.outputPath("salesforce-data.png") });
  await window.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await window.screenshot({ path: testInfo.outputPath('salesforce-data-light.png') });
  await workbench.locator('.sf-soql-record').getByRole('button', { name: 'Close', exact: true }).click();
  await window.setViewportSize({ width: 720, height: 900 });
  expect(await workbench.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await window.screenshot({ path: testInfo.outputPath('salesforce-data-narrow.png') });
  await window.setViewportSize({ width: 1440, height: 900 });
  await window.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  // Standalone production browsing must not ask for an agent thread, including
  // schema loading, queries without LIMIT, and record inspection.
  await workbench.getByTestId("salesforce-org-picker").selectOption("org-158");
  await expect(workbench.locator(".sf-org-switcher-kind")).toHaveText("production");
  await expect(workbench.getByRole("alert")).toHaveCount(0);
  await workbench.getByTestId("soql-editor").fill("SELECT Id, Name FROM Account");
  await workbench.getByTestId("soql-run").click();
  await expect(workbench.getByTestId("soql-results")).toContainText("Customer 159");
  await workbench.getByRole("button", { name: "Customer 0", exact: true }).click();
  await expect(workbench.locator(".sf-soql-record")).toContainText("Read only");
  await expect(workbench.getByRole("alert")).toHaveCount(0);
  await workbench.getByTestId("salesforce-org-picker").selectOption("org-159");
  await expect(workbench.getByTestId("salesforce-org-picker")).toHaveValue("org-159");
  await workbench
    .getByRole("tab", { name: "Deployments", exact: true })
    .click();
  await workbench.getByRole("button", { name: "Browse org metadata" }).click();
  await workbench.getByLabel('Search metadata').fill('Class179');
  await expect(workbench.getByLabel('Select Class179', { exact: true })).toBeVisible();
  await workbench.getByLabel('Search metadata').fill('Class');
  await workbench.getByLabel("Select Class0", { exact: true }).check();
  await workbench.getByLabel("Select Class1", { exact: true }).check();
  await workbench.getByLabel("Targeted Apex tests").fill("OneTest");
  const configBox = await workbench.locator('.sf-workspace-config').boundingBox();
  const activityBox = await workbench.getByTestId('salesforce-operations').boundingBox();
  expect(activityBox!.x).toBeGreaterThan(configBox!.x + 250);
  await window.screenshot({ path: testInfo.outputPath('salesforce-deployment-setup-dark.png') });
  await window.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await window.screenshot({ path: testInfo.outputPath('salesforce-deployment-setup-light.png') });
  await window.setViewportSize({ width: 720, height: 900 });
  expect(await workbench.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await window.screenshot({ path: testInfo.outputPath('salesforce-deployment-setup-narrow.png') });
  await window.setViewportSize({ width: 1440, height: 900 });
  await window.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await workbench.getByRole("button", { name: "Preview deployment" }).click();
  await expect(workbench.getByTestId("salesforce-operations")).toContainText(
    "succeeded",
  );
  await expect(
    workbench.getByRole("region", { name: "Conflicts" }),
  ).toContainText("ApexClass:Class1");
  await expect(
    workbench.getByRole("region", { name: "To deploy" }),
  ).toContainText("ApexClass:Class0");
  await expect(
    workbench.getByText("Preview only. Listed changes have not been applied."),
  ).toBeVisible();
  await workbench
    .getByRole("button", { name: "Validate", exact: true })
    .click();
  await expect(
    workbench.getByRole("button", { name: "Refresh report" }),
  ).toBeVisible();
  await workbench.getByRole("button", { name: "Refresh report" }).click();
  await expect(
    workbench.getByRole("region", { name: "Component failures" }),
  ).toContainText("Variable does not exist: invoice");
  await expect(
    workbench.getByRole("region", { name: "Component failures" }),
  ).toContainText("line 7, column 3");
  await window.screenshot({
    path: testInfo.outputPath("salesforce-deployment-report.png"),
  });
  await workbench.getByLabel("Metadata type").selectOption("Flow");
  await workbench.getByRole("button", { name: "Browse org metadata" }).click();
  await expect(workbench.getByRole("alert")).toContainText(
    "Fixture metadata denied",
  );
  await workbench.getByRole("tab", { name: "Data", exact: true }).click();
  await expect(workbench.getByTestId("soql-editor")).toHaveValue(
    "SELECT Id, Name FROM Account",
  );

  const threadId = await window.evaluate(async (projectId) => {
    const response = await fetch("/api/v1/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        providerId: "fake",
        model: "fake-model",
        permissionMode: "full",
        input: "Salesforce panel fixture",
      }),
    });
    const json = await response.json();
    if (!response.ok) throw Error(JSON.stringify(json));
    return (json.thread ?? json.value).id as string;
  }, projectId);
  await route(window, `/threads/${threadId}`);
  await expect(window.getByTestId("thread-detail")).toBeVisible();
  // Deliver the old New Tab save after the record panel opens. This exercises
  // the real server event that formerly overwrote the user's newer local tab.
  await window.evaluate((id) => {
    const originalFetch = window.fetch.bind(window);
    const probe = window as typeof window & { releaseTabSave?: () => void };
    let held = false;
    window.fetch = async (input, init) => {
      if (
        !held &&
        String(input).endsWith(`/threads/${id}/tabs`) &&
        init?.method === "PUT" &&
        JSON.parse(String(init.body)).tabs.some(
          (tab: { kind: string }) => tab.kind === "new-tab",
        )
      ) {
        held = true;
        await new Promise<void>((resolve) => {
          probe.releaseTabSave = resolve;
        });
      }
      return originalFetch(input, init);
    };
  }, threadId);
  await window
    .getByRole("button", { name: "Show right panel", exact: true })
    .click();
  const recordAction = window.getByRole("button", {
    name: "Salesforce record",
    exact: true,
  });
  if (!(await recordAction.isVisible()))
    await window.getByRole("button", { name: "New tab", exact: true }).click();
  await expect
    .poll(() =>
      window.evaluate(() =>
        Boolean(
          (window as typeof window & { releaseTabSave?: () => void })
            .releaseTabSave,
        ),
      ),
    )
    .toBe(true);
  await recordAction.click();
  await window.evaluate(() => {
    (
      window as typeof window & { releaseTabSave?: () => void }
    ).releaseTabSave?.();
  });
  expect(rendererErrors).toEqual([]);
  await expect(
    window.getByRole("combobox", { name: "Salesforce org", exact: true }),
  ).toHaveValue("org-159");
  await expect
    .poll(() =>
      window.evaluate(async (id) => {
        const { tabs } = await fetch(`/api/v1/threads/${id}/tabs`).then(
          (response) => response.json(),
        );
        return tabs.some(
          (tab: { kind: string; actionId?: string }) =>
            tab.kind === "plugin-panel" && tab.actionId === "sf-record",
        );
      }, threadId),
    )
    .toBe(true);
  await window.getByLabel("Record id", { exact: true }).fill("001000000000000");
  await window.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect(
    window.getByRole("heading", { name: "Customer 0", exact: true }),
  ).toBeVisible();
  await window.screenshot({
    path: testInfo.outputPath("salesforce-native-record.png"),
  });
  const resize = window.getByRole("separator", { name: "Resize right panel" });
  const bounds = await resize.boundingBox();
  if (!bounds) throw Error("Native panel resize handle is missing");
  const width = await window.evaluate(() => innerWidth);
  await window.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await window.mouse.down();
  await window.mouse.move(width - 360, bounds.y + bounds.height / 2, {
    steps: 8,
  });
  await window.mouse.up();
  await window.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await expect(
    window.getByRole("heading", { name: "Customer 0", exact: true }),
  ).toBeVisible();
  const surface = window
    .getByTestId("thread-secondary-panel")
    .locator(".sf-surface")
    .first();
  expect(
    await surface.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  await window.screenshot({
    path: testInfo.outputPath("salesforce-narrow-light.png"),
  });

  await window.getByRole("button", { name: "New tab", exact: true }).click();
  await window
    .getByRole("button", { name: "Apex & logs", exact: true })
    .click();
  const apexPanel = window.getByTestId("thread-secondary-panel");
  await apexPanel
    .getByLabel("Apex test class", { exact: true })
    .fill("OneTest");
  await apexPanel.getByRole("button", { name: "Run targeted tests" }).click();
  const failures = apexPanel.getByRole("region", { name: "Test failures" });
  await expect(failures).toContainText("Expected 2 records, got 1");
  await failures.getByText("Stack trace", { exact: true }).click();
  await expect(
    failures.getByText("Class.OneTest.saves: line 18, column 1"),
  ).toBeVisible();
  await failures
    .getByRole("button", { name: "Add OneTest.saves to prompt" })
    .click();
  const promptContext = window.locator(".thread-command-editor");
  await expect(promptContext).toContainText("Failed: OneTest.saves");
  await expect(promptContext).toContainText("apex.test · org-159");
  await expect(promptContext).not.toContainText("OneTest.works");
  expect(
    await apexPanel
      .locator(".sf-surface")
      .first()
      .evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  await window.screenshot({
    path: testInfo.outputPath("salesforce-apex-failure-narrow.png"),
  });

  const agent = makeFakeGenericHoldBinary();
  let sessionId: string | undefined;
  try {
    await window.evaluate(
      (bin) => window.cc.config.set({ claudeBinary: bin }),
      agent.path,
    );
    sessionId = await window.evaluate(async (projectId) => {
      const result = await window.cc.terminals.create({
        projectId,
        profile: "claude",
        cols: 80,
        rows: 24,
      });
      if (!result.ok) throw Error(result.message);
      return result.value.id;
    }, projectId);
    await route(window, `/projects/${projectId}/sessions/${sessionId}`);
    const show = window.getByRole("button", {
      name: "Show right panel",
      exact: true,
    });
    if (await show.isVisible()) await show.click();
    await window.getByRole("button", { name: "New tab", exact: true }).click();
    await window
      .getByRole("button", { name: "Salesforce record", exact: true })
      .click();
    await expect(
      window.getByRole("combobox", { name: "Salesforce org", exact: true }),
    ).toHaveValue("org-159");
    await window
      .getByLabel("Record id", { exact: true })
      .fill("001000000000000");
    await window.getByRole("button", { name: "Inspect", exact: true }).click();
    await expect(
      window.getByRole("heading", { name: "Customer 0", exact: true }),
    ).toBeVisible();
    await window.screenshot({
      path: testInfo.outputPath("salesforce-cli-panel.png"),
    });
  } finally {
    if (sessionId)
      await window.evaluate((id) => window.cc.terminals.close(id), sessionId);
    agent.cleanup();
  }
  await route(window, `/projects/${projectId}`);
  await window.getByRole('navigation', { name: 'dx navigation' }).getByRole('button', { name: 'Salesforce', exact: true }).click();
  await expect(workbench.getByTestId('salesforce-org-picker')).toHaveValue('org-159');
  await workbench.getByRole('tab', { name: 'Apex & logs', exact: true }).click();
  await workbench.getByRole('tab', { name: 'Debug logs', exact: true }).click();
  await expect(workbench.getByText('No debug logs returned')).toBeVisible();
  await workbench.getByRole('button', { name: 'Refresh logs' }).click();
  await expect(workbench.getByText('Refresh proof')).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Refresh logs' })).toBeEnabled();
  await workbench.getByRole('button', { name: /Refresh proof.*Success/ }).click();
  await workbench.getByLabel('Find in log').fill('EXCEPTION_THROWN');
  await expect(workbench.getByText('1 match')).toBeVisible();
  await workbench.getByRole('button', { name: 'Next match' }).click();
  await expect(workbench.locator('.sf-log-code mark')).toBeInViewport();
  await window.screenshot({ path: testInfo.outputPath('salesforce-log-reader.png') });
  await window.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await window.setViewportSize({ width: 720, height: 900 });
  await workbench.getByRole('button', { name: 'Next match' }).click();
  await expect(workbench.locator('.sf-log-code mark')).toBeInViewport();
  expect(await workbench.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await window.screenshot({ path: testInfo.outputPath('salesforce-log-reader-narrow.png') });
  await window.setViewportSize({ width: 1440, height: 900 });
  await window.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await workbench.getByRole('tab', { name: 'Anonymous Apex', exact: true }).click();
  await workbench.getByRole('textbox', { name: 'Anonymous Apex', exact: true }).fill('System.debug(42);');
  await workbench.getByRole('button', { name: 'Continue in a thread' }).click();
  await expect.poll(() => new URL(window.url()).searchParams.get('prompt')).toContain('System.debug(42);');
  const stagedPrompt = new URL(window.url()).searchParams.get('prompt')!;
  expect(stagedPrompt).toContain('org-159');
  expect(stagedPrompt).toContain('do not execute automatically');
  await expect(window.locator('[contenteditable="true"]').first()).toContainText('System.debug(42);');
  await window.screenshot({ path: testInfo.outputPath('salesforce-action-review.png') });
  const trace = readFileSync(join(home, "sf-trace.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(trace.some(row => row.args[0] === 'apex' && row.args[1] === 'run')).toBe(false);
  expect(rendererErrors).toEqual([]);
  const deployment = trace.find((row) => row.args.includes("--dry-run"));
  expect(deployment).toMatchObject({
    home,
    cwd: realpathSync(join(home, "dx")),
  });
  expect(deployment.args).toEqual(
    expect.arrayContaining(["--target-org", "org-159", "--tests", "OneTest"]),
  );
});
