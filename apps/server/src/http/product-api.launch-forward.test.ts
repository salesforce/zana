import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { startProductServer } from './product-server.js';

describe('team launch policy forwarding', () => {
  it('preserves shared flat launch options and rejects invalid ones', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'launch-forward-'));
    const server = await startProductServer({ dataDir, origins: { serverPort: 0, devAppPort: 5173 } });
    const launch = vi.fn(async () => ({ ok: true as const, value: { kind: 'job' as const, id: 'e' } }));
    const preview = vi.fn(async () => ({ ok: true as const, value: { previewToken: 'main-token', path: '/registered' } }));
    server.ctx.teamOps = { launch, preview } as never;
    const base = { teamId: 't', projectId: 'p', goal: 'ship', mode: 'freeform' };
    const options = { worktree: false, onComplete: 'leave', push: false, checks: ['unit'], failurePolicyDefault: 'fail-run', target: { kind: 'project-root' } };
    const post = (body: unknown) => fetch(`${server.url}api/v1/teams/launch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    try {
      expect((await post({ ...base, ...options })).status).toBe(201);
      expect(launch.mock.calls[0]![0]).toMatchObject(options);
      const previewResponse = await fetch(`${server.url}api/v1/teams/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...base, ...options }) });
      expect(previewResponse.status).toBe(200);
      expect(await previewResponse.json()).toMatchObject({ ok: true, value: { previewToken: 'main-token' } });
      expect(preview.mock.calls[0]![0]).toMatchObject(options);
      expect((await post({ ...base, push: 'yes' })).status).toBe(400);
      expect(launch).toHaveBeenCalledTimes(1);

      // planText: forwarded trimmed on both routes, capped, and blank means absent.
      const postTo = (route: string, body: unknown) => fetch(`${server.url}api/v1/teams/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      expect((await postTo('launch', { ...base, planText: '  the plan \n' })).status).toBe(201);
      expect(launch.mock.calls[1]![0]).toMatchObject({ goal: 'ship', planText: 'the plan' });
      expect((await postTo('preview', { ...base, planText: 'the plan', coordinationMode: 'structured' })).status).toBe(200);
      expect(preview.mock.calls[1]![0]).toMatchObject({ planText: 'the plan' });
      expect((await postTo('launch', { ...base, planText: '   ' })).status).toBe(201);
      expect(launch.mock.calls[2]![0]).not.toHaveProperty('planText');
      expect((await postTo('launch', { ...base, planText: 'x'.repeat(64_000) })).status).toBe(201);
      for (const route of ['launch', 'preview']) {
        for (const planText of ['x'.repeat(64_001), 42, { a: 1 }]) {
          const rejected = await postTo(route, { ...base, planText });
          expect(rejected.status).toBe(400);
          expect(await rejected.json()).toMatchObject({ code: 'INVALID' });
        }
      }
      expect(launch).toHaveBeenCalledTimes(4);
      expect(preview).toHaveBeenCalledTimes(2);
    } finally {
      await server.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
