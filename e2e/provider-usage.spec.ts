import { test, expect } from "./fixtures/app.js";

test.use({
  initialConfig: { sponsorPromptDismissed: true },
  launchEnv: { ZCC_FAKE_PROVIDER: "1" },
});

test("Provider Usage installs and refreshes in built Electron", async ({ app }, testInfo) => {
  test.setTimeout(120000);
  const win = app.window;
  const catalogue = await win.evaluate(() => window.cc.extensions.marketplaceList());
  expect(catalogue).toMatchObject({ ok: true });
  if (!catalogue.ok) throw new Error(catalogue.message);
  expect(catalogue.value.map(row => row.id)).toContain("provider-usage");
  for (const id of ["concurrency-limit", "send-later", "theme-preview"]) {
    expect(catalogue.value.map(row => row.id)).not.toContain(id);
  }
  expect(await win.evaluate(() => window.cc.extensions.install({ kind: "bundled", id: "provider-usage" }))).toMatchObject({ ok: true });
  // Bundled installation enables this plugin; wait for activation instead of reloading it.
  await expect.poll(() => win.evaluate(async () => (await window.cc.pluginApps.list()).find(row => row.id === "provider-usage")), { timeout: 60000 }).toMatchObject({ enabled: true, status: "running" });
  await win.getByRole("button", { name: "Provider Usage", exact: true }).click();
  await expect(
    win.getByRole("heading", { name: "Provider Usage", exact: true }),
  ).toBeVisible();
  await expect(win.getByRole("button", { name: /Refresh/ })).toBeVisible();
  await expect(
    win.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled({ timeout: 65000 });
  await win.screenshot({ path: testInfo.outputPath("provider-usage.png") });
});
