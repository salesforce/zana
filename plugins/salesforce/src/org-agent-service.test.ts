import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OrgAgentService, parseAgentCatalog } from '../lib/org-agent-service.js';
import type { ExecSfOptions, PublicOrgView } from '../lib/types.js';

const org: PublicOrgView = { alias: 'sandbox', orgId: '00D000000000001', username: 'me@example.com', instanceUrl: 'https://example.com', apiVersion: '67.0', kind: 'sandbox', isDefault: false };
const roots: string[] = [];
const services: OrgAgentService[] = [];
const ok = (result: unknown) => ({ code: 0, stdout: JSON.stringify({ status: 0, result }), stderr: '' });
function project() { const root = mkdtempSync(join(tmpdir(), 'sf-agents-test-')); roots.push(root); return root; }
function fixture() {
  const root = project();
  let temporary = '';
  const execSf = vi.fn(async (args: string[], options?: ExecSfOptions) => {
    if (args[0] === 'org') return ok([{ fullName: 'Support_v2', lastModifiedDate: '2026-09-23' }]);
    temporary = options!.cwd!;
    const bundle = join(temporary, 'force-app/main/default/aiAuthoringBundles/Support_v2');
    mkdirSync(bundle, { recursive: true });
    writeFileSync(join(bundle, 'Support_v2.agent'), 'config:\n  agent_name: "Support"\n' + '# source\n'.repeat(2000) + '# SOURCE_COMPLETE');
    writeFileSync(join(bundle, 'Support_v2.bundle-meta.xml'), '<AiAuthoringBundle><target>Support.v1</target></AiAuthoringBundle>');
    return ok({ success: true, done: true });
  });
  const connect = vi.fn(async () => org);
  const service = new OrgAgentService({ execSf, connect }); services.push(service);
  return { root, service, execSf, connect, temporary: () => temporary };
}
async function finish(service: OrgAgentService, root: string, jobId: string) {
  await vi.waitFor(() => expect(service.status(root, jobId).state).not.toBe('running'));
  return service.status(root, jobId);
}
afterEach(() => { for (const service of services.splice(0)) service.dispose(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('org agent sources', () => {
  it('groups exact authoring versions, deduplicates and bounds inventories', () => {
    const catalog = parseAgentCatalog([{ fullName: 'Support_v2' }, { fullName: 'Support_v12' }, { fullName: 'Support_v2' }, { fullName: 'Other#3' }, { fullName: 'Current' }, { fullName: '../bad' }, null]);
    expect(catalog.agents.map(agent => agent.name)).toEqual(['Current', 'Other', 'Support']);
    expect(catalog.agents[2].versions.map(version => version.version)).toEqual([12, 2]);
    expect(catalog.agents[0].versions[0].version).toBeNull();
    expect(parseAgentCatalog(Array.from({ length: 1001 }, (_, index) => ({ fullName: `Agent_${index}` }))).truncated).toBe(true);
    expect(() => parseAgentCatalog({ records: [] })).toThrow('invalid agent inventory');
  });

  it('lists public identities and retrieves a complete version without overwriting local edits', async () => {
    const { service, execSf, root, temporary } = fixture();
    expect(await service.list()).toMatchObject({ org: { alias: 'sandbox', orgId: org.orgId }, agents: [{ name: 'Support' }] });
    const { jobId } = await service.start(root, { fullName: 'Support_v2', orgId: org.orgId });
    const result = await finish(service, root, jobId);
    expect(result.state).toBe('done'); if (result.state !== 'done') return;
    expect(result.file).toMatchObject({ existing: false, orgId: org.orgId, fullName: 'Support_v2' });
    const path = join(root, result.file.path);
    expect(readFileSync(path, 'utf8')).toContain('# SOURCE_COMPLETE');
    expect(readFileSync(path.replace('.agent', '.bundle-meta.xml'), 'utf8')).toContain('Support.v1');
    expect(execSf.mock.calls[1]).toEqual([['project', 'retrieve', 'start', '--metadata', 'AiAuthoringBundle:Support_v2', '--target-org', 'sandbox', '--json', '--wait', '2'], expect.objectContaining({ cwd: temporary(), timeoutMs: 120_000, signal: expect.any(AbortSignal) })]);
    expect(existsSync(temporary())).toBe(false);
    writeFileSync(path, 'local edits');
    const reopened = await service.start(root, { fullName: 'Support_v2', orgId: org.orgId });
    expect(await finish(service, root, reopened.jobId)).toMatchObject({ state: 'done', file: { existing: true } });
    expect(readFileSync(path, 'utf8')).toBe('local edits');
    expect(execSf).toHaveBeenCalledTimes(2);
    expect(readdirSync(join(root, 'agentforce', org.orgId))).toEqual(['Support_v2']);
  });

  it('rejects unconfined names, stale org selections and cross-project jobs', async () => {
    const { service, root, execSf } = fixture();
    for (const name of ['../escape', 'Support*', '--help', 'Support/a', 'Support\\a', '']) await expect(service.start(root, { fullName: name, orgId: org.orgId })).rejects.toThrow('Choose an agent');
    await expect(service.start(root, { fullName: 'Support', orgId: 'old' })).rejects.toThrow('org changed');
    expect(execSf).not.toHaveBeenCalled();
    const { jobId } = await service.start(root, { fullName: 'Support', orgId: org.orgId });
    expect(() => service.status(project(), jobId)).toThrow('current project');
    expect(() => service.status(root, 'missing')).toThrow('current project');
    await finish(service, root, jobId);
  });

  it('refuses symlinked local destinations and leaves outside files untouched', async () => {
    const { service, root } = fixture(); const outside = project();
    symlinkSync(outside, join(root, 'agentforce'));
    const { jobId } = await service.start(root, { fullName: 'Support_v2', orgId: org.orgId });
    expect(await finish(service, root, jobId)).toMatchObject({ state: 'failed', error: expect.stringContaining('symbolic link') });
    expect(readdirSync(outside)).toEqual([]);
  });

  it.each(['missing', 'large', 'symlink', 'ambiguous', 'too-many', 'unfinished', 'failed', 'invalid-json'])('cleans up a %s retrieval', async mode => {
    const { service, root, execSf } = fixture(); let temporary = '';
    execSf.mockImplementation(async (_args, opts) => {
      temporary = opts!.cwd!;
      const folder = join(temporary, 'force-app');
      if (mode === 'large') writeFileSync(join(folder, 'Test.agent'), 'x'.repeat(180001));
      if (mode === 'symlink') symlinkSync(root, join(folder, 'escape'));
      if (mode === 'ambiguous') { writeFileSync(join(folder, 'One.agent'), 'one'); writeFileSync(join(folder, 'Two.agent'), 'two'); }
      if (mode === 'too-many') for (let index = 0; index < 101; index++) writeFileSync(join(folder, `${index}.txt`), '');
      if (mode === 'unfinished') return ok({ done: false });
      if (mode === 'failed') return { code: 1, stdout: JSON.stringify({ status: 1, message: 'Access denied' }), stderr: '' };
      if (mode === 'invalid-json') return { code: 1, stdout: 'incomplete', stderr: '' };
      return ok({ success: true });
    });
    const { jobId } = await service.start(root, { fullName: 'Support_v2', orgId: org.orgId });
    expect(await finish(service, root, jobId)).toMatchObject({ state: 'failed' });
    expect(existsSync(temporary)).toBe(false);
    expect(existsSync(join(root, 'agentforce'))).toBe(false);
  });

  it('bounds concurrent retrievals and aborts them on cancellation or disposal', async () => {
    const { service, root, execSf } = fixture(); let release!: () => void; let signal!: AbortSignal;
    execSf.mockImplementation(async (_args, opts) => { signal = opts!.signal!; await new Promise<void>(resolve => { release = resolve; }); return ok({ success: true }); });
    const { jobId } = await service.start(root, { fullName: 'Support_v2', orgId: org.orgId });
    await expect(service.start(root, { fullName: 'Another', orgId: org.orgId })).rejects.toThrow('already running');
    service.cancel(root, jobId); expect(signal.aborted).toBe(true); release();
    expect(await finish(service, root, jobId)).toMatchObject({ state: 'failed' });
    service.dispose();
    await expect(service.start(root, { fullName: 'Another', orgId: org.orgId })).rejects.toThrow('restarting');
    await expect(service.list()).rejects.toThrow('busy');
  });

  it('bounds concurrent inventories and surfaces malformed CLI output', async () => {
    const { service, execSf } = fixture(); let release!: (value: ReturnType<typeof ok>) => void;
    const pending = new Promise<ReturnType<typeof ok>>(resolve => { release = resolve; });
    execSf.mockReturnValue(pending);
    const first = service.list(); const second = service.list();
    await expect(service.list()).rejects.toThrow('busy');
    release(ok([])); await Promise.all([first, second]);
    execSf.mockResolvedValue({ code: 127, stdout: '{}', stderr: 'not found' });
    await expect(service.list()).rejects.toThrow('could not retrieve');
  });
});
