import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConversationThread, createEnvironment, getConversationThread, upsertHost } from '@zana-ai/zcc-db';
import { startProductServer, type ProductServer } from './product-server.js';

const { binaries, runs } = vi.hoisted(() => ({ binaries: [] as string[], runs: [] as unknown[] }));
vi.mock('@zana-ai/zcc-llm', async (importOriginal) => ({
  ...await importOriginal<typeof import('@zana-ai/zcc-llm')>(),
  ClaudeCliProvider: class {
    readonly id = 'claude-cli';
    constructor(binary: string) { binaries.push(binary); }
    async run(request: unknown) {
      runs.push(request);
      return { ok: true, text: 'Configured test title', provider: this.id, ms: 0 };
    }
  },
}));

let server: ProductServer | undefined;
let dataDir: string | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  binaries.length = 0;
  runs.length = 0;
});

describe('server background Claude configuration', () => {
  it.each([
    { name: 'canonical entry overrides stale legacy default', config: { harnesses: { byId: { claude: { binary: '/test/canonical-claude' } } }, claudeBinary: 'claude' }, expected: '/test/canonical-claude' },
    { name: 'canonical entry survives removal of the legacy field', config: { harnesses: { byId: { claude: { binary: '/test/canonical-claude' } } } }, expected: '/test/canonical-claude' },
    { name: 'legacy config remains supported', config: { claudeBinary: '/test/legacy-claude' }, expected: '/test/legacy-claude' },
    { name: 'unconfigured installations retain the default', config: {}, expected: 'claude' },
  ])('$name', async ({ config, expected }) => {
    dataDir = mkdtempSync(join(tmpdir(), 'zcc-llm-config-'));
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify(config));
    server = await startProductServer({ dataDir, origins: { serverPort: 0 } });
    const host = upsertHost(server.ctx.db, { name: 'test', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(server.ctx.db, { projectId: 'project', hostId: host.id, path: dataDir });
    const thread = createConversationThread(server.ctx.db, {
      projectId: 'project', hostId: host.id, environmentId: environment.id, providerId: 'fake', titleSource: 'prompt',
    });
    server.ctx.threadTitleNamer.request(thread.id, 'Name the test thread');
    await vi.waitFor(() => expect(getConversationThread(server!.ctx.db, thread.id)?.title).toBe('Configured test title'));
    expect(binaries).toEqual([expected]);

    // Summaries share the same resolver and must observe settings changed after boot.
    server.ctx.config.setConfig({ harnesses: { byId: { claude: { binary: '/test/updated-claude' } } } });
    await server.ctx.closeSummary.summarizeAndFollowUpFromLastTurn('project', {
      sessionId: thread.id, title: 'Test', lastTurn: 'Finished the test task',
    });
    expect(binaries).toEqual([expected, '/test/updated-claude']);
  });

  it('runs the wrap-up summary through the session-summary prompt on the configured Claude', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'zcc-llm-session-summary-'));
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ claudeBinary: '/test/summary-claude' }));
    server = await startProductServer({ dataDir, origins: { serverPort: 0 } });
    const res = await server.ctx.closeSummary.summarizeForClose('project', 'thread-1', {
      digest: 'User: do it\n\nAssistant: done',
      title: 'Test'
    });
    expect(res.ok).toBe(true);
    expect(binaries).toEqual(['/test/summary-claude']);
    expect(JSON.stringify(runs[0])).toContain('You summarize one coding agent');
    expect(JSON.stringify(runs[0])).toContain('User: do it');
  });

  it('reports a missing session-summary prompt instead of running', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'zcc-llm-session-summary-missing-'));
    server = await startProductServer({ dataDir, origins: { serverPort: 0 } });
    const { PromptRegistry } = await import('@zana-ai/zcc-llm');
    const get = vi.spyOn(PromptRegistry.prototype, 'get').mockReturnValue(undefined);
    try {
      const deps = (server.ctx.closeSummary as any).deps;
      expect(await deps.runSessionSummary('digest', 'key')).toMatchObject({ ok: false, error: 'no session-summary prompt' });
      expect(runs).toHaveLength(0);
    } finally {
      get.mockRestore();
    }
  });

  it('keeps a renamed or auto-named thread title across a server restart', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'zcc-llm-title-restart-'));
    server = await startProductServer({ dataDir, origins: { serverPort: 0 } });
    const host = upsertHost(server.ctx.db, { name: 'test', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(server.ctx.db, { projectId: 'project', hostId: host.id, path: dataDir });
    const create = () => createConversationThread(server!.ctx.db, {
      projectId: 'project', hostId: host.id, environmentId: environment.id, providerId: 'fake', title: 'fix the login', titleSource: 'prompt',
    });
    const renamed = create();
    const autoNamed = create();
    server.ctx.threadTitleNamer.request(autoNamed.id, 'fix the login');
    await vi.waitFor(() => expect(getConversationThread(server!.ctx.db, autoNamed.id)?.title).toBe('Configured test title'));
    const patched = await fetch(`${server.url}api/v1/threads/${renamed.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'My name' })
    });
    expect(patched.status).toBe(200);
    await server.close();

    // A fresh server has an empty in-memory namer; only the persisted title source guards these.
    server = await startProductServer({ dataDir, origins: { serverPort: 0 } });
    runs.length = 0;
    server.ctx.threadTitleNamer.request(renamed.id, 'now add tests');
    server.ctx.threadTitleNamer.request(autoNamed.id, 'now add tests');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(runs).toEqual([]);
    expect(getConversationThread(server.ctx.db, renamed.id)?.title).toBe('My name');
    expect(getConversationThread(server.ctx.db, autoNamed.id)?.title).toBe('Configured test title');
  });
});
