import { describe, expect, it, vi } from 'vitest';
import { OrgLoginService } from '../lib/org-login-service.js';
import type { ExecResult, PublicListedOrg } from '../lib/types.js';

const org: PublicListedOrg = { alias: 'new-dev', username: 'new@example.com', orgId: '00D1', instanceUrl: 'https://dev.my.salesforce.com', kind: 'sandbox', isDefault: false, connectedStatus: 'Connected' };
const result = { code: 0, stdout: JSON.stringify({ result: { username: org.username, accessToken: 'SECRET', refreshToken: 'SECRET' } }), stderr: 'SECRET' };
function setup() {
  const deps = { execSf: vi.fn(async () => result), listOrgs: vi.fn(async () => [org]), invalidate: vi.fn() };
  return { deps, service: new OrgLoginService(deps) };
}

describe('org browser login', () => {
  it('identifies only the returned username, passes a bounded command and selects after refreshing', async () => {
    const { deps, service } = setup();
    const onConnected = vi.fn(async () => undefined);
    const response = await service.run({ instance: 'custom', instanceUrl: 'company.my.salesforce.com' }, { cwd: '/project', onConnected });
    expect(response).toMatchObject({ ok: true, connectedAlias: org.alias });
    expect(JSON.stringify(response)).not.toContain('SECRET');
    expect(deps.execSf).toHaveBeenCalledWith(['org', 'login', 'web', '--json', '--instance-url', 'https://company.my.salesforce.com'], expect.objectContaining({ cwd: '/project', timeoutMs: 600_000, signal: expect.any(AbortSignal) }));
    expect(deps.invalidate).toHaveBeenCalledOnce();
    expect(onConnected).toHaveBeenCalledWith(org.alias, [org]);
  });

  it('does not start an invalid login', async () => {
    const { deps, service } = setup();
    expect(await service.run({ instance: 'custom', instanceUrl: 'https://evil.example' })).toMatchObject({ ok: false });
    expect(deps.execSf).not.toHaveBeenCalled();
  });

  it.each([127, 1, 143])('sanitizes failure %i and permits retry', async code => {
    const { deps, service } = setup();
    deps.execSf.mockResolvedValueOnce({ ...result, code });
    const response = await service.run({});
    expect(response).toMatchObject({ ok: false, code: code === 127 ? 'cli_missing' : 'login_failed' });
    expect(JSON.stringify(response)).not.toContain('SECRET');
    expect(deps.listOrgs).not.toHaveBeenCalled();
    expect(await service.run({})).toMatchObject({ ok: true });
  });

  it('bounds concurrent sign-ins and aborts the child on disposal', async () => {
    const { deps, service } = setup();
    let finish!: (value: ExecResult) => void;
    deps.execSf.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = service.run({});
    expect(await service.run({})).toMatchObject({ code: 'login_busy' });
    service.dispose();
    expect((deps.execSf.mock.calls[0] as unknown as [unknown, { signal: AbortSignal }])[1].signal.aborted).toBe(true);
    finish(result);
    expect(await first).toMatchObject({ code: 'login_failed' });
    service.dispose();
  });

  it('does not expose thrown process or list errors', async () => {
    const { deps, service } = setup();
    deps.execSf.mockRejectedValueOnce(Error('SECRET'));
    expect(await service.run({})).toMatchObject({ code: 'login_failed', error: expect.not.stringContaining('SECRET') });
    deps.listOrgs.mockRejectedValueOnce(Error('SECRET'));
    expect(await service.run({})).toMatchObject({ code: 'orgs_failed', error: expect.not.stringContaining('SECRET') });
  });

  it('does not change the project if disposed while refreshing the roster', async () => {
    const { deps, service } = setup();
    deps.listOrgs.mockImplementationOnce(async () => { service.dispose(); return [org]; });
    const onConnected = vi.fn();
    expect(await service.run({}, { onConnected })).toMatchObject({ code: 'login_failed' });
    expect(onConnected).not.toHaveBeenCalled();
  });

  it.each(['bad json', '{}', '{"result":null}', '{"result":{"username":7}}', '{"result":{"username":"someone-else"}}'])('never guesses which org to select from %s', async stdout => {
    const { deps, service } = setup();
    deps.execSf.mockResolvedValueOnce({ ...result, stdout });
    const onConnected = vi.fn();
    expect(await service.run({ alias: 'new-dev' }, { onConnected })).toMatchObject({ ok: true, connectedAlias: null, warning: expect.any(String) });
    expect(onConnected).not.toHaveBeenCalled();
  });

  it('uses the username when no alias exists and reports a failed project selection separately', async () => {
    const { deps, service } = setup();
    deps.listOrgs.mockResolvedValueOnce([{ ...org, alias: '' }]);
    expect(await service.run({})).toMatchObject({ connectedAlias: org.username });
    expect(await service.run({}, { onConnected: async () => { throw Error('SECRET'); } })).toMatchObject({ ok: true, warning: expect.stringContaining('could not select') });
  });
});
