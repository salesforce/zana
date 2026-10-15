import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

test('Browser Automation resolves machine names through the production plugin SDK', async ({ app }) => {
  test.setTimeout(120_000);
  const { window, home } = app;
  const root = join(home, 'browser-selector-project');
  mkdirSync(root);
  const threadId = await window.evaluate(async (path) => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Machine selector check' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return (body.thread ?? body.value).id as string;
  }, root);
  const installed = await window.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'browser-automation' }));
  expect(installed).toMatchObject({ ok: true });
  const trust = window.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => window.evaluate(async () => {
    const plugin = (await window.cc.pluginApps.list()).find((entry) => entry.id === 'browser-automation');
    if (plugin?.status === 'degraded') throw new Error(JSON.stringify(plugin));
    return `${plugin?.enabled}:${plugin?.status}`;
  }), { timeout: 30_000 }).toBe('true:running');
  const results = await window.evaluate(async (threadId) => {
    const hostsResponse = await fetch('/api/v1/hosts');
    const body = await hostsResponse.json();
    const hosts = Array.isArray(body) ? body : body.hosts;
    const host = hosts.find((candidate: { online?: boolean }) => candidate.online) ?? hosts[0];
    if (!host) throw new Error('Isolated host was not enrolled');
    const open = async (machine: string) => {
      const response = await fetch('/api/v1/plugins/browser-automation/cli', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ threadId, argv: ['open', '--backend', 'desktop', '--machine', machine, '--desktop', 'missing-instance', '--json'] })
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    };
    const cli = async (argv: string[], withThread = true) => {
      const response = await fetch('/api/v1/plugins/browser-automation/cli', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...(withThread ? { threadId } : {}), argv })
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    };
    return {
      byName: await open(host.name), byId: await open(host.id), missing: await open('missing-machine-e2e'),
      help: await cli(['run', '--help'], false),
      timeout: await cli(['run', '00000000-0000-4000-8000-000000000001', '--script', '1', '--timeout', '90s', '--json']),
      invalidTimeout: await cli(['run', '00000000-0000-4000-8000-000000000001', '--script', '1', '--timeout', '121s', '--json'])
    };
  }, threadId);
  // Both selectors reached the actual desktop broker, which rejects our
  // deliberately absent instance without creating a browser or lease.
  expect(results.byName).toMatchObject({ exitCode: 1, stderr: 'Selected desktop is unavailable; choose a connected instance explicitly' });
  expect(results.byId).toEqual(results.byName);
  expect(results.missing).toMatchObject({ exitCode: 1, stderr: "Machine 'missing-machine-e2e' was not found" });
  expect(results.help.exitCode).toBe(0);
  expect(results.help.stdout).toContain('--timeout <duration>');
  expect(results.help.stdout).toContain('500 KB');
  expect(results.timeout.exitCode).toBe(1);
  expect(JSON.parse(results.timeout.stdout)).toMatchObject({ ok: false, error: { code: 'session_unavailable' } });
  expect(results.invalidTimeout.exitCode).toBe(1);
  expect(JSON.parse(results.invalidTimeout.stdout)).toMatchObject({ ok: false, error: { code: 'command_failed', message: expect.stringContaining('between 1000 and 120000') } });
});
