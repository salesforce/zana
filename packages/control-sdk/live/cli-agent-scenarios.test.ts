import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ControlError } from '../src/errors.js';
import { liveEnabled } from '../src/matrix.js';
import {
  SCENARIO_PROFILES,
  harnessRoutingFor,
  pidIsDead,
  withLiveAgent,
  writeAllowRouting
} from './cli-agent-helpers.js';

const enabled = liveEnabled();
const SCENARIO_TIMEOUT_MS = 180_000;

function findMarkerFile(root: string, marker: string, preferred: string): string | undefined {
  if (existsSync(preferred)) {
    try {
      if (readFileSync(preferred, 'utf8').includes(marker)) return preferred;
    } catch {
      /* fall through */
    }
  }
  let names: string[] = [];
  try {
    names = readdirSync(root, { recursive: true, encoding: 'utf8' }) as string[];
  } catch {
    return undefined;
  }
  for (const name of names.slice(0, 200)) {
    const path = join(root, String(name));
    try {
      if (readFileSync(path, 'utf8').includes(marker)) return path;
    } catch {
      /* directory or unreadable */
    }
  }
  return undefined;
}

async function waitUntilGone(
  refresh: () => Promise<{ status: string }>,
  sleep: (ms: number) => Promise<void>,
  nowMs: () => number,
  timeoutMs = 10_000
): Promise<'not-found' | 'exited' | 'done'> {
  const deadline = nowMs() + timeoutMs;
  while (nowMs() < deadline) {
    try {
      const row = await refresh();
      if (row.status === 'exited' || row.status === 'done') return row.status;
    } catch (error) {
      if (error instanceof ControlError && error.code === 'NOT_FOUND') return 'not-found';
      throw error;
    }
    await sleep(200);
  }
  throw new ControlError('TIMEOUT', 'CLI agent did not leave the live list after stop()');
}

describe.skipIf(!enabled)('live CLI Agent scenarios', () => {
  it.each(SCENARIO_PROFILES)('%s second turn: idle → reply → idle', async (profile) => {
    await withLiveAgent(profile, async ({ zcc, project }) => {
      const agent = await zcc.cliAgents.launch({
        projectId: project.id,
        profile,
        harnessRouting: harnessRoutingFor(profile),
        prompt: 'Reply with exactly PONG1 then stop. Do not use tools. Do not ask questions.'
      });
      await agent.wait({ until: 'idle', timeoutMs: 120_000 });
      await agent.reply('Reply with exactly PONG2 then stop. Do not use tools. Do not ask questions.');
      await agent.wait({ until: 'idle', timeoutMs: 120_000 });
      await agent.stop().catch(() => undefined);
    });
  }, SCENARIO_TIMEOUT_MS);

  it.each(SCENARIO_PROFILES)('%s writes a unique file in the live-sandbox', async (profile) => {
    await withLiveAgent(profile, async ({ zcc, project }) => {
      if (!project.path) {
        throw new Error(`live-sandbox project ${project.id} is missing path`);
      }
      if (!existsSync(join(project.path, '.git'))) {
        execFileSync('git', ['init'], { cwd: project.path });
      }
      const readme = join(project.path, 'README.md');
      if (!existsSync(readme)) {
        writeFileSync(readme, '# live-sandbox\n', 'utf8');
      }
      const relative = `zcc-live-${zcc.runId}-${profile}.txt`;
      const absolute = join(project.path, relative);
      const marker = `zcc-live:${zcc.runId}:${profile}`;
      const prompt = [
        `Create the file ${relative} in the current working directory (the project root).`,
        `Use a file-write tool. Do not only print the contents. Do not ask questions.`,
        `The file body must include this exact marker: ${marker}`
      ].join(' ');
      try {
        const agent = await zcc.cliAgents.launch({
          projectId: project.id,
          profile,
          harnessRouting: writeAllowRouting(profile),
          prompt
        });
        const sawWorking = await agent.wait({ until: 'working', timeoutMs: 15_000 }).catch(() => null);
        if (!sawWorking || sawWorking.status !== 'working') {
          await agent.reply(prompt);
        }
        const deadline = zcc.http.nowMs() + 120_000;
        while (zcc.http.nowMs() < deadline) {
          try {
            const row = await agent.refresh();
            if (row.status === 'exited') break;
            if (row.status === 'idle' || row.status === 'done') break;
          } catch (error) {
            if (error instanceof ControlError && error.code === 'NOT_FOUND') break;
            throw error;
          }
          await zcc.http.sleep(250);
        }
        if (!findMarkerFile(project.path, marker, absolute)) {
          await agent.reply(prompt).catch(() => undefined);
          const retryUntil = zcc.http.nowMs() + 120_000;
          while (zcc.http.nowMs() < retryUntil) {
            try {
              const row = await agent.refresh();
              if (row.status === 'exited' || row.status === 'idle' || row.status === 'done') break;
            } catch (error) {
              if (error instanceof ControlError && error.code === 'NOT_FOUND') break;
              throw error;
            }
            await zcc.http.sleep(250);
          }
        }
        await agent.stop().catch(() => undefined);
        const found = findMarkerFile(project.path, marker, absolute);
        expect(found, `${absolute} was not created`).toBeTruthy();
        expect(readFileSync(found!, 'utf8')).toContain(marker);
      } finally {
        for (const path of [absolute]) {
          try { unlinkSync(path); } catch { /* leftover from a failed write */ }
        }
        const leftover = findMarkerFile(project.path, marker, absolute);
        if (leftover) {
          try { unlinkSync(leftover); } catch { /* ignore */ }
        }
      }
    });
  }, SCENARIO_TIMEOUT_MS);

  it.each(SCENARIO_PROFILES)('%s stop() while working tears the session down', async (profile) => {
    await withLiveAgent(profile, async ({ zcc, project }) => {
      const agent = await zcc.cliAgents.launch({
        projectId: project.id,
        profile,
        harnessRouting: harnessRoutingFor(profile),
        prompt: 'Count slowly from 1 to 200, printing each number. Do not finish early. Do not use tools.'
      });
      const working = await agent.wait({ until: 'working', timeoutMs: 30_000 }).catch(() => agent.snapshot());
      const pid = working.pid;
      await agent.stop().catch((error: unknown) => {
        if (!(error instanceof ControlError && error.code === 'NOT_FOUND')) throw error;
      });
      const fate = await waitUntilGone(
        () => agent.refresh(),
        (ms) => zcc.http.sleep(ms),
        () => zcc.http.nowMs()
      );
      expect(['not-found', 'exited', 'done']).toContain(fate);
      if (typeof pid === 'number' && pid > 0) {
        const deadline = zcc.http.nowMs() + 10_000;
        while (zcc.http.nowMs() < deadline && !pidIsDead(pid)) {
          await zcc.http.sleep(200);
        }
        expect(pidIsDead(pid), `pid ${pid} still alive after stop()`).toBe(true);
      }
    });
  }, SCENARIO_TIMEOUT_MS);
});

describe.skipIf(enabled)('live CLI Agent scenarios (gated)', () => {
  it('stays skipped without ZCC_LIVE_CONTROL', () => {
    expect(liveEnabled()).toBe(false);
    expect(ControlError).toBeDefined();
  });
});
