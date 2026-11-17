import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runTeamCommand } from './team.js';
import { readPersonas } from '../store-readers.js';

// REQ-2 (CLI status and wait show the failure reason) and REQ-17 (the CLI persona reader agrees with the server).
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function router(routes: Record<string, unknown>): typeof fetch {
  return (async (input, init) => {
    const key = `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`;
    return key in routes ? response(routes[key]) : response({ error: `unmocked ${key}` }, 404);
  }) as typeof fetch;
}

describe('team wait and status show the failure reason (REQ-2)', () => {
  const failed = { id: 'ex-1', kind: 'job', state: 'FAILED', teamId: 't1', failureReason: 'no portable plan steps found' };

  it('wait prints the failure reason instead of "no persisted result payload"', async () => {
    const result = await runTeamCommand('wait', ['ex-1'], false, { fetchImpl: router({ 'GET /api/v1/executions/ex-1': { value: failed } }) });
    expect(result?.stderr + (result?.stdout ?? '')).toContain('no portable plan steps found');
    expect(result?.stderr).not.toContain('no persisted result payload');
  });

  it('wait --json carries the failure reason', async () => {
    const result = await runTeamCommand('wait', ['ex-1'], true, { fetchImpl: router({ 'GET /api/v1/executions/ex-1': { value: failed } }) });
    expect(`${result?.stdout}${result?.stderr}`).toContain('no portable plan steps found');
  });

  it('status prints the failure reason for a failed run', async () => {
    const result = await runTeamCommand('status', ['ex-1'], false, { fetchImpl: router({ 'GET /api/v1/executions/ex-1': { value: failed } }) });
    expect(result?.stdout).toContain('no portable plan steps found');
  });

  it('a failed run with a persisted result still prints that result (existing-user path)', async () => {
    const result = await runTeamCommand('wait', ['ex-1'], false, { fetchImpl: router({ 'GET /api/v1/executions/ex-1': { value: { ...failed, result: 'Final text' } } }) });
    expect(result?.stdout).toBe('Final text\n');
    expect(result?.stderr).toContain('Failure reason: no portable plan steps found');
  });

  it('a completed run without a result keeps the old error (existing-user path)', async () => {
    const result = await runTeamCommand('wait', ['ex-1'], false, { fetchImpl: router({ 'GET /api/v1/executions/ex-1': { value: { id: 'ex-1', state: 'COMPLETED' } } }) });
    expect(result?.exitCode).toBe(1);
    expect(result?.stderr).toContain('no persisted result payload');
  });

  it('status of an older failed record without the field still prints the row (existing-user path)', async () => {
    const result = await runTeamCommand('status', ['ex-1'], false, { fetchImpl: router({ 'GET /api/v1/executions/ex-1': { value: { id: 'ex-1', kind: 'job', state: 'FAILED', teamId: 't1' } } }) });
    expect(result?.stdout).toContain('ex-1\tjob\tFAILED\tt1');
  });
});

describe('CLI persona reader agrees with the server drop rules (REQ-17)', () => {
  function dataDirWith(files: Record<string, unknown>): string {
    const dir = mkdtempSync(join(tmpdir(), 'swi-cli-personas-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'personas'), { recursive: true });
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, 'personas', name), typeof body === 'string' ? body : JSON.stringify(body));
    return dir;
  }

  it.each([
    ['bad baseProfile', { id: 'a', name: 'A', baseProfile: 'nope' }],
    ['bad permissionMode', { id: 'a', name: 'A', permissionMode: 'wild' }],
    ['bad modelLevel', { id: 'a', name: 'A', modelLevel: 'huge' }],
    ['bad skills', { id: 'a', name: 'A', skills: ['*'] }],
    ['non-string model', { id: 'a', name: 'A', model: 7 }],
    ['empty id', { id: ' ', name: 'A' }]
  ])('drops %s and reports it, as the server does', (_label, body) => {
    const { data, warnings } = readPersonas(dataDirWith({ 'a.json': body }), []);
    expect(data.find((p) => p.id === 'a')).toBeUndefined();
    expect(warnings.join('\n')).toContain('a.json');
  });

  it('keeps a valid persona and reports no warning (existing-user path)', () => {
    const { data, warnings } = readPersonas(dataDirWith({ 'good.json': { id: 'good', name: 'Good' } }), []);
    expect(data.map((p) => p.id)).toEqual(['good']);
    expect(warnings).toEqual([]);
  });

  it('does not echo file content in a malformed-JSON warning', () => {
    const { warnings } = readPersonas(dataDirWith({ 'leaky.json': '{"id":"s3cr3t-token", ' }), []);
    expect(warnings.join('\n')).toContain('leaky.json');
    expect(warnings.join('\n')).not.toContain('s3cr3t');
  });
});
