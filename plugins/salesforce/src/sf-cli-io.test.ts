import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { createContainedSpawner, createExecSf, salesforceRestRequest } from '../lib/sf-cli.js';
import type { ResolvedOrg } from '../lib/types.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn()
}));

const mocked = vi.mocked(execFile);

function org(): ResolvedOrg {
  return {
    alias: 'dev',
    username: 'dev@example.com',
    orgId: '00D',
    instanceUrl: 'https://example.my.salesforce.com',
    accessToken: 'TOKEN',
    apiVersion: '62.0',
    kind: 'sandbox',
    isDefault: true
  };
}

describe('sf CLI process wrappers', () => {
  afterEach(() => {
    mocked.mockReset();
  });

  it('treats a missing binary as exit 127', async () => {
    mocked.mockImplementation((_cmd, _args, _opts, cb) => {
      const fn = cb as (error: Error | null, stdout: string, stderr: string) => void;
      fn(Object.assign(new Error('missing'), { code: 'ENOENT' }), '', '');
      return undefined as never;
    });
    await expect(createExecSf()(['--version'])).resolves.toEqual({ code: 127, stdout: '', stderr: '' });
  });

  it('reads numeric status when code is absent', async () => {
    mocked.mockImplementation((_cmd, _args, _opts, cb) => {
      const fn = cb as (error: Error | null, stdout: string, stderr: string) => void;
      fn(Object.assign(new Error('killed'), { status: 9 }), '', 'killed');
      return undefined as never;
    });
    await expect(createExecSf()(['--version'])).resolves.toEqual({ code: 9, stdout: '', stderr: 'killed' });
  });

  it('returns numeric exit codes and spawns contained bins with cwd', async () => {
    mocked.mockImplementation((cmd, args, opts, cb) => {
      const fn = cb as (error: Error | null, stdout: string, stderr: string) => void;
      if (cmd === 'sf') fn(Object.assign(new Error('fail'), { code: 2 }), 'out', 'err');
      else {
        expect(opts).toMatchObject({ cwd: '/proj' });
        fn(null, 'ok', '');
      }
      return undefined as never;
    });
    await expect(createExecSf()(['org', 'list'])).resolves.toEqual({ code: 2, stdout: 'out', stderr: 'err' });
    await expect(createContainedSpawner()('/proj/node_modules/.bin/sfdx-lwc-jest', ['--', 'hello'], '/proj')).resolves.toEqual({
      code: 0,
      stdout: 'ok',
      stderr: ''
    });
  });

  it('defaults to exit 1 when the process error has no code', async () => {
    mocked.mockImplementation((_cmd, _args, _opts, cb) => {
      const fn = cb as (error: Error | null, stdout: string, stderr: string) => void;
      fn(new Error('fail'), '', '');
      return undefined as never;
    });
    await expect(createExecSf()(['--version'])).resolves.toEqual({ code: 1, stdout: '', stderr: '' });
  });
});

describe('Salesforce REST transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends versioned requests and parses JSON without putting the token in thrown errors', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toContain('/services/data/v62.0/query');
      expect(String(input)).toContain('q=SELECT');
      expect(init.headers).toMatchObject({ Authorization: 'Bearer TOKEN' });
      return {
        status: 200,
        text: async () => '{"totalSize":1}'
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await salesforceRestRequest(org(), {
      method: 'GET',
      path: 'query',
      query: { q: 'SELECT Id FROM Account' }
    });
    expect(response).toEqual({ status: 200, json: { totalSize: 1 }, text: '{"totalSize":1}' });
  });

  it('keeps non-JSON bodies as text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, text: async () => 'DEBUG|line' })));
    const response = await salesforceRestRequest(org(), { method: 'GET', path: '/tooling/sobjects/ApexLog/1/Body' });
    expect(response.json).toBeNull();
    expect(response.text).toBe('DEBUG|line');
  });

  it('posts JSON bodies on mutating REST calls', async () => {
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe('{"tests":[]}');
      return { status: 200, text: async () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await salesforceRestRequest(org(), { method: 'POST', path: '/tooling/runTestsSynchronous', body: { tests: [] } });
    expect(response).toEqual({ status: 200, json: null, text: '' });
  });
});
