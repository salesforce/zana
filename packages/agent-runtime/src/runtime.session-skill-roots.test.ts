import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgentRuntimeWithAdapters } from './runtime.js';
import { createFakeAdapter } from './test/fake-adapter.js';
import { fullRuntimeOptions } from './test/runtime-test-harness.js';
import type { AdapterCommand } from './provider-adapter.js';
import type { AgentRuntime, AgentRuntimeSkillRoot } from './types.js';

const runtimes: AgentRuntime[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.shutdown()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
it('selects a fresh provider process for new session skills while old sessions keep their roots', async () => {
  const workspacePath = mkdtempSync(join(tmpdir(), 'zcc-runtime-catalog-')); dirs.push(workspacePath);
  const commands: Array<{ process: number; command: AdapterCommand }> = [];
  let processes = 0;
  const runtime = createAgentRuntimeWithAdapters({
    workspacePath, onEvent() {}, onToolCall: async () => ({ contentItems: [], success: true }),
    adapterFactory: () => {
      const adapter = createFakeAdapter({ id: 'claude-code' });
      const process = ++processes;
      return { ...adapter, buildCommandPlan(command) { commands.push({ process, command }); return adapter.buildCommandPlan(command); } };
    }
  });
  runtimes.push(runtime);
  const roots = (name: string): AgentRuntimeSkillRoot[] => [{ id: 'catalog', providerId: 'claude-code', localPluginPath: join(workspacePath, name) }];
  const base = { environmentId: 'env', projectId: 'p', providerId: 'claude-code', options: fullRuntimeOptions };
  await runtime.startThread({ ...base, threadId: 'old', skillRoots: roots('old') });
  await runtime.startThread({ ...base, threadId: 'new', skillRoots: roots('new') });
  await runtime.startThread({ ...base, threadId: 'same', skillRoots: roots('new') });
  const starts = commands.filter(row => row.command.type === 'thread/start');
  expect(starts[0].process).not.toBe(starts[1].process);
  expect(starts[1].process).toBe(starts[2].process);
  expect(commands.filter(row => row.command.type === 'skills/configure').map(row => row.command))
    .toEqual([{ type: 'skills/configure', skillRoots: roots('old') }, { type: 'skills/configure', skillRoots: roots('new') }]);
  await runtime.renameThread({ threadId: 'old', title: 'old still works' });
  expect(commands.at(-1)?.process).toBe(starts[0].process);
  await runtime.stopThread({ threadId: 'old' });
  expect(runtime.hasThread('new')).toBe(true);
  await runtime.resumeThread({ ...base, threadId: 'resumed', providerThreadId: 'persisted', skillRoots: roots('new') });
  expect(commands.filter(row => row.command.type === 'thread/resume').at(-1)?.process).toBe(starts[1].process);
});
