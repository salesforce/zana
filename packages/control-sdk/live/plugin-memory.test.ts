import { describe, expect, it } from 'vitest';
import { liveEnabled, isSkip, preflightOrSkip } from '../src/matrix.js';
import { Zcc } from '../src/client.js';

const enabled = liveEnabled();
const PLUGIN_ID = 'memory';
const MODEL_TIMEOUT_MS = 90_000;

type PluginRow = { id?: string; status?: string; enabled?: boolean };
type CliResult = { exitCode?: number; stdout?: string; stderr?: string };
type MemoryRow = {
  id: string;
  name: string;
  summary?: string;
  details?: string;
  scope?: string;
  version?: number;
  projectId?: string | null;
  sourceThreadId?: string | null;
};

async function loadPlugins(zcc: Zcc): Promise<PluginRow[]> {
  const listed = await zcc.http.request<{ plugins?: PluginRow[] } | PluginRow[]>(
    'GET',
    '/api/v1/plugins'
  );
  return Array.isArray(listed) ? listed : listed.plugins ?? [];
}

async function runMemoryCli(
  zcc: Zcc,
  argv: string[],
  context: { projectId?: string; threadId?: string } = {}
): Promise<CliResult> {
  return zcc.http.request<CliResult>(
    'POST',
    `/api/v1/plugins/${encodeURIComponent(PLUGIN_ID)}/cli`,
    { body: { argv, ...context } }
  );
}

function parseStdout<T>(result: CliResult): T {
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout, result.stderr).toBeTruthy();
  return JSON.parse(result.stdout!) as T;
}

async function requireRunningMemory(zcc: Zcc, label: string): Promise<boolean> {
  const plugins = await loadPlugins(zcc);
  const plugin = plugins.find((row) => row.id === PLUGIN_ID);
  if (plugin?.status !== 'running') {
    console.warn(
      `[live] skip ${label}: plugin "${PLUGIN_ID}" is ${plugin?.status ?? 'missing'}`
    );
    return false;
  }
  await zcc.http
    .request('POST', `/api/v1/plugin-apps/${encodeURIComponent(PLUGIN_ID)}/reload`, { body: {} })
    .catch(() => undefined);
  return true;
}

async function forgetCreated(zcc: Zcc, created: MemoryRow[], projectId?: string): Promise<void> {
  for (const memory of created) {
    await runMemoryCli(
      zcc,
      [
        'forget',
        memory.id,
        '--expected-version',
        String(memory.version ?? 1),
        '--reason',
        'control-sdk live memory cleanup',
        '--json'
      ],
      { projectId: projectId ?? memory.projectId ?? undefined }
    ).catch(() => undefined);
  }
}

function dumpText(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, item) => {
      if (item && typeof item === 'object') {
        if (seen.has(item)) return '[Circular]';
        seen.add(item);
      }
      return item;
    });
  } catch {
    return String(value);
  }
}

describe.skipIf(!enabled)('live memory plugin CLI', () => {
  it('adds, searches, isolates, and forgets memories through product HTTP', async () => {
    const zcc = await Zcc.connect();
    const created: MemoryRow[] = [];
    try {
      if (!(await requireRunningMemory(zcc, 'memory CLI'))) return;

      const project = await zcc.projects.ensureLiveSandbox();
      const stamp = `live-mem-${zcc.runId}`;
      const threadId = `sdk-${zcc.runId}`;
      const privateDetails = `private-detail-${zcc.runId}-must-not-leak`;

      const global = parseStdout<{ memory: MemoryRow }>(
        await runMemoryCli(
          zcc,
          [
            'add',
            '--scope',
            'global',
            '--name',
            `${stamp}-global`,
            '--summary',
            `${stamp} prefer concise evidence-first updates`,
            '--details',
            privateDetails,
            '--reason',
            'control-sdk live memory test',
            '--kind',
            'preference',
            '--json'
          ],
          { projectId: project.id, threadId }
        )
      ).memory;
      created.push(global);

      const projectMemory = parseStdout<{ memory: MemoryRow }>(
        await runMemoryCli(
          zcc,
          [
            'add',
            '--scope',
            'project',
            '--name',
            `${stamp}-project`,
            '--summary',
            `${stamp} use turbo for typechecks`,
            '--details',
            `${privateDetails} project`,
            '--reason',
            'control-sdk live memory test',
            '--kind',
            'procedure',
            '--json'
          ],
          { projectId: project.id, threadId }
        )
      ).memory;
      created.push(projectMemory);

      const catalog = parseStdout<{ memories: MemoryRow[] }>(
        await runMemoryCli(zcc, ['catalog', '--scope', 'all', '--json'], { projectId: project.id })
      );
      const catalogIds = catalog.memories.map((row) => row.id);
      expect(catalogIds).toContain(global.id);
      expect(catalogIds).toContain(projectMemory.id);
      expect(catalog.memories.find((row) => row.id === global.id)?.details).toBeUndefined();

      const searched = parseStdout<{ memories: MemoryRow[] }>(
        await runMemoryCli(zcc, ['search', stamp, '--scope', 'all', '--json'], {
          projectId: project.id
        })
      );
      expect(searched.memories.map((row) => row.id)).toEqual(
        expect.arrayContaining([global.id, projectMemory.id])
      );
      expect(searched.memories.every((row) => row.details === undefined)).toBe(true);
      expect(JSON.stringify(searched)).not.toContain(privateDetails);

      const got = parseStdout<{ memory: MemoryRow }>(
        await runMemoryCli(zcc, ['get', projectMemory.id, '--scope', 'all', '--json'], {
          projectId: project.id
        })
      );
      expect(got.memory.details).toContain(privateDetails);
      expect(got.memory.sourceThreadId).toBe(threadId);

      const hidden = await runMemoryCli(zcc, ['get', projectMemory.id, '--scope', 'all', '--json'], {
        projectId: `other-${zcc.runId}`
      });
      expect(hidden.exitCode).toBe(1);
      expect(hidden.stderr ?? '').toContain('not found in the current scope');

      const visibleGlobal = parseStdout<{ memory: MemoryRow }>(
        await runMemoryCli(zcc, ['get', global.id, '--scope', 'all', '--json'], {
          projectId: `other-${zcc.runId}`
        })
      );
      expect(visibleGlobal.memory.id).toBe(global.id);

      const updated = parseStdout<{ memory: MemoryRow }>(
        await runMemoryCli(
          zcc,
          [
            'update',
            global.id,
            '--expected-version',
            String(global.version ?? 1),
            '--summary',
            `${stamp} prefer concise evidence with citations`,
            '--reason',
            'control-sdk live memory update',
            '--json'
          ],
          { projectId: project.id, threadId }
        )
      );
      expect(updated.memory.version).toBe((global.version ?? 1) + 1);
      global.version = updated.memory.version;
    } finally {
      await forgetCreated(zcc, created);
      await zcc.close();
    }
  });

  it('lets a live model retrieve memory details with zcc memory', async () => {
    const zcc = await Zcc.connect();
    const created: MemoryRow[] = [];
    try {
      if (!(await requireRunningMemory(zcc, 'memory model'))) return;
      const pre = await preflightOrSkip(zcc, { surface: 'thread', providerId: 'claude-code' });
      if (isSkip(pre)) {
        console.warn(`[live] skip memory model: ${pre.reason}`);
        return;
      }

      const project = await zcc.projects.ensureLiveSandbox();
      const name = `live-mem-${zcc.runId}-model`;
      const marker = `pnpm live-mem-${zcc.runId}`;
      const memory = parseStdout<{ memory: MemoryRow }>(
        await runMemoryCli(
          zcc,
          [
            'add',
            '--scope',
            'project',
            '--name',
            name,
            '--summary',
            `The live-sandbox build command is ${marker}.`,
            '--details',
            'Full procedure belongs in details and must not be required for this check.',
            '--reason',
            'control-sdk live memory model test',
            '--kind',
            'procedure',
            '--importance',
            '100',
            '--pinned',
            '--json'
          ],
          { projectId: project.id, threadId: `sdk-${zcc.runId}` }
        )
      ).memory;
      created.push(memory);

      const thread = await zcc.threads.spawn({
        projectId: project.id,
        providerId: 'claude-code',
        permissionMode: 'accept-edits',
        visibility: 'hidden',
        prompt: [
          'Do not use tools.',
          'Your thread instructions include a ZCC memory catalog for this project.',
          'Quote the live-sandbox build command recorded in that catalog, then stop.'
        ].join(' ')
      });
      try {
        const deadline = zcc.http.nowMs() + MODEL_TIMEOUT_MS;
        let dump = '';
        while (zcc.http.nowMs() < deadline) {
          const row = await thread.refresh();
          if (row.status === 'error') {
            throw new Error(`thread ${thread.id} entered error before retrieving ${name}`);
          }
          const interactions = await thread.interactions().catch(() => []);
          for (const item of interactions) {
            if (!item.id) continue;
            await thread.resolveInteraction(item.id, {
              decision: 'allow_once',
              grantedPermissions: null
            }).catch(() => undefined);
          }
          const [timeline, events] = await Promise.all([
            thread.timeline().catch(() => null),
            zcc.http
              .request('GET', `/api/v1/threads/${encodeURIComponent(thread.id)}/events`)
              .catch(() => null)
          ]);
          dump = dumpText({ timeline, events });
          if (dump.includes(marker)) break;
          await zcc.http.sleep(1_000);
        }
        expect(dump, `thread ${thread.id} never surfaced memory details for ${name}`).toContain(marker);
      } finally {
        await thread.stop().catch(() => undefined);
      }
    } finally {
      await forgetCreated(zcc, created);
      await zcc.close();
    }
  }, 120_000);
});

describe.skipIf(enabled)('live memory plugin CLI (gated)', () => {
  it('does not run without ZCC_LIVE_CONTROL=1', () => {
    expect(liveEnabled()).toBe(false);
  });
});
