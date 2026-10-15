import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OrgAgentService, parseAgentCatalog } from '../lib/org-agent-service.js';
import type { ExecSfOptions, PublicOrgView } from '../lib/types.js';
import { AGENT_SOURCE_MAX } from '../lib/studio-contract.js';

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
      if (mode === 'large') writeFileSync(join(folder, 'Test.agent'), 'x'.repeat(AGENT_SOURCE_MAX + 1));
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

  describe('reading one version', () => {
    type Bundle = { target?: string; content?: string; scripts?: number; meta?: string };
    function reader(bundles: Record<string, Bundle>, after?: (folder: string) => void) {
      const { service, execSf } = fixture(); let temporary = '';
      execSf.mockImplementation(async (args, options) => {
        if (args[0] === 'org') return ok(Object.keys(bundles).map(fullName => ({ fullName })));
        temporary = options!.cwd!;
        const root = join(temporary, 'force-app/main/default/aiAuthoringBundles');
        const requested = args.filter(arg => arg.startsWith('AiAuthoringBundle:')).map(arg => arg.slice('AiAuthoringBundle:'.length));
        for (const [fullName, bundle] of Object.entries(bundles).filter(([name]) => requested.includes(name))) {
          const folder = join(root, fullName);
          mkdirSync(folder, { recursive: true });
          for (let index = 0; index < (bundle.scripts ?? 1); index++) writeFileSync(join(folder, `${fullName}${index ? index : ''}.agent`), bundle.content ?? `${fullName} source`);
          writeFileSync(join(folder, `${fullName}.bundle-meta.xml`), bundle.meta ?? `<AiAuthoringBundle><target> ${bundle.target ?? ''} </target></AiAuthoringBundle>`);
        }
        after?.(root);
        return ok({ success: true, done: true });
      });
      return { service, execSf, temporary: () => temporary };
    }

    it('retrieves the newest bundles once, picks the one whose target is the version and deletes the folder', async () => {
      const bundles = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`Help_v${index + 1}`, { target: `Help.v${index + 1}` }]));
      const { service, execSf, temporary } = reader({ ...bundles, Help_v13: { target: 'Help.v12' }, Other_v1: { target: 'Help.v12' } });
      await expect(service.readVersion(org, 'Help', 12)).resolves.toEqual({ fullName: 'Help_v13', content: 'Help_v13 source' });
      const retrieve = execSf.mock.calls[1]![0];
      expect(retrieve.filter(arg => arg.startsWith('AiAuthoringBundle:'))).toEqual(['13', '12', '11', '10', '9', '8', '7', '6', '5', '4'].map(n => `AiAuthoringBundle:Help_v${n}`));
      expect(execSf.mock.calls[1]![1]).toMatchObject({ cwd: temporary(), timeoutMs: 120_000, signal: expect.any(AbortSignal) });
      expect(existsSync(temporary())).toBe(false);
      await expect(service.readVersion(org, 'Help', 1)).rejects.toThrow('None of the 10 newest Help authoring bundles on sandbox published v1.');
    });

    it.each([
      ['symlink', { Help_v1: { target: 'Help.v1' } }, (root: string) => symlinkSync(tmpdir(), join(root, 'escape')), 'symbolic link'],
      ['too-many', { Help_v1: { target: 'Help.v1' } }, (root: string) => { for (let index = 0; index < 1001; index++) writeFileSync(join(root, `${index}.txt`), ''); }, 'too many files'],
      ['deep', { Help_v1: { target: 'Help.v1' } }, (root: string) => mkdirSync(join(root, ...Array.from({ length: 12 }, () => 'd')), { recursive: true }), 'nested folders'],
      ['large', { Help_v1: { target: 'Help.v1', content: 'x'.repeat(AGENT_SOURCE_MAX + 1) } }, undefined, 'size limit'],
      ['ambiguous', { Help_v1: { target: 'Help.v1', scripts: 2 } }, undefined, 'no single Agent Script'],
      ['oversized metadata', { Help_v1: { meta: `<target>Help.v1</target>${' '.repeat(64_001)}` } }, undefined, 'published v1'],
    ] as const)('cleans up after a %s retrieval', async (_mode, bundles, after, error) => {
      const { service, temporary } = reader(bundles, after);
      await expect(service.readVersion(org, 'Help', 1)).rejects.toThrow(error);
      expect(existsSync(temporary())).toBe(false);
    });

    it('frees the read when the temp folder cannot be made', async () => {
      const { service, execSf } = reader({ Help_v1: { target: 'Help.v1' } });
      const saved = process.env.TMPDIR;
      process.env.TMPDIR = join(tmpdir(), 'zcc-sf-missing-tmp', 'gone');
      try {
        await expect(service.readVersion(org, 'Help', 1)).rejects.toThrow('ENOENT');
      } finally {
        if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved;
      }
      expect(execSf).not.toHaveBeenCalled();
      await expect(service.readVersion(org, 'Help', 1)).resolves.toEqual({ fullName: 'Help_v1', content: 'Help_v1 source' });
    });

    it('refuses bad input, unfinished retrievals and a second read, and aborts on disposal', async () => {
      const { service, execSf } = reader({ Help_v1: { target: 'Help.v1' } });
      for (const [name, version] of [["Help' OR", 1], ['Help', 0], ['Help', 1.5]] as const) await expect(service.readVersion(org, name, version)).rejects.toThrow('Pick a version');
      expect(execSf).not.toHaveBeenCalled();
      await expect(service.readVersion(org, 'Missing', 1)).rejects.toThrow('Missing has no authoring bundle on sandbox.');
      execSf.mockImplementationOnce(async () => ok([{ fullName: 'Help_v1' }])).mockImplementationOnce(async () => ok({ done: false }));
      await expect(service.readVersion(org, 'Help', 1)).rejects.toThrow('did not complete');
      let release!: () => void; let signal!: AbortSignal;
      execSf.mockImplementationOnce(async (_args, options) => { signal = options!.signal!; await new Promise<void>(resolve => { release = resolve; }); return ok([{ fullName: 'Help_v1' }]); });
      const first = service.readVersion(org, 'Help', 1);
      await vi.waitFor(() => expect(signal).toBeDefined());
      await expect(service.readVersion(org, 'Help', 1)).rejects.toThrow('already opening');
      service.dispose();
      expect(signal.aborted).toBe(true);
      release();
      await expect(first).rejects.toThrow();
      await expect(service.readVersion(org, 'Help', 1)).rejects.toThrow('restarting');
    });
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
