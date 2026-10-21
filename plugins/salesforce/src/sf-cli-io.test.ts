import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { createContainedSpawner, createExecSf, NODE_CLI_PROCESS, salesforceRestRequest } from '../lib/sf-cli.js';
import type { ResolvedOrg } from '../lib/types.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn()
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

describe('default CLI process deps', () => {
  afterEach(() => {
    mocked.mockReset();
  });

  it('kills a Windows process tree with taskkill and resolves sf from the real environment', () => {
    NODE_CLI_PROCESS.killTree(42);
    expect(mocked).toHaveBeenCalledWith('taskkill', ['/pid', '42', '/T', '/F'], { windowsHide: true }, expect.any(Function));
    (mocked.mock.calls[0]![3] as () => void)();
    const launch = NODE_CLI_PROCESS.resolveWindowsSf();
    expect(launch === null || typeof launch.command === 'string').toBe(true);
  });
});

describe('sf on macOS and Linux', () => {
  const execSf = createExecSf({ ...NODE_CLI_PROCESS, platform: 'linux' });

  afterEach(() => {
    mocked.mockReset();
  });

  it('runs sf through execFile with the timeout, buffer cap, signal and cwd', async () => {
    const controller = new AbortController();
    mocked.mockImplementation((cmd, args, opts, cb) => {
      expect([cmd, args]).toEqual(['sf', ['agent', 'validate', 'authoring-bundle']]);
      expect(opts).toEqual({ timeout: 120_000, maxBuffer: 2_000_000, windowsHide: true, signal: controller.signal, cwd: '/proj' });
      (cb as (error: Error | null, stdout: string, stderr: string) => void)(null, '{"status":0}', '');
      return undefined as never;
    });
    await expect(execSf(['agent', 'validate', 'authoring-bundle'], { cwd: '/proj', timeoutMs: 120_000, signal: controller.signal }))
      .resolves.toEqual({ code: 0, stdout: '{"status":0}', stderr: '' });
  });

  it('maps execFile errors to exit codes and defaults missing output', async () => {
    mocked.mockImplementation((_cmd, _args, opts, cb) => {
      expect(opts).toEqual({ timeout: 30_000, maxBuffer: 2_000_000, windowsHide: true });
      (cb as (error: Error | null, stdout?: string, stderr?: string) => void)(Object.assign(new Error('missing'), { code: 'ENOENT' }));
      return undefined as never;
    });
    await expect(execSf(['--version'])).resolves.toEqual({ code: 127, stdout: '', stderr: '' });
  });
});

describe('contained bin spawner', () => {
  afterEach(() => {
    mocked.mockReset();
  });

  it('spawns contained bins with cwd', async () => {
    mocked.mockImplementation((_cmd, _args, opts, cb) => {
      expect(opts).toMatchObject({ cwd: '/proj' });
      (cb as (error: Error | null, stdout: string, stderr: string) => void)(null, 'ok', '');
      return undefined as never;
    });
    await expect(createContainedSpawner()('/proj/node_modules/.bin/sfdx-lwc-jest', ['--', 'hello'], '/proj')).resolves.toEqual({
      code: 0,
      stdout: 'ok',
      stderr: ''
    });
  });

  it('maps contained-bin errors to exit codes', async () => {
    const errors = [
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
      Object.assign(new Error('killed'), { status: 9 }),
      Object.assign(new Error('fail'), { code: 2 }),
      new Error('fail')
    ];
    const codes: number[] = [];
    for (const error of errors) {
      mocked.mockImplementationOnce((_cmd, _args, _opts, cb) => {
        (cb as (error: Error | null, stdout: string, stderr: string) => void)(error, '', '');
        return undefined as never;
      });
      codes.push((await createContainedSpawner()('/bin/x', [], '/proj')).code);
    }
    expect(codes).toEqual([127, 9, 2, 1]);
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

  it('honors a per-request API version override', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      expect(String(input)).toContain('/services/data/v63.0/einstein/ai-evaluations/runs');
      return { status: 200, text: async () => '{"id":"run-1"}' };
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await salesforceRestRequest(org(), {
      method: 'POST',
      path: '/einstein/ai-evaluations/runs',
      body: { aiEvaluationDefinitionName: 'My_Eval' },
      apiVersion: '63.0'
    });
    expect(response.json).toEqual({ id: 'run-1' });
  });

  it('keeps non-JSON bodies as text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, text: async () => 'DEBUG|line' })));
    const response = await salesforceRestRequest(org(), { method: 'GET', path: '/tooling/sobjects/ApexLog/1/Body' });
    expect(response.json).toBeNull();
    expect(response.text).toBe('DEBUG|line');
  });

  it('forwards an AbortSignal to fetch', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(init?.signal).toBeTruthy();
      expect(init?.signal?.aborted).toBe(false);
      controller.abort();
      expect(init?.signal?.aborted).toBe(true);
      return { status: 200, text: async () => '{}' };
    });
    vi.stubGlobal('fetch', fetchMock);
    await salesforceRestRequest(org(), { method: 'GET', path: '/query', signal: controller.signal });
    expect(fetchMock).toHaveBeenCalled();
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
