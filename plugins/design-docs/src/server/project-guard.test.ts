import { describe, expect, it, vi } from 'vitest';
import type { PluginCliContext } from '@zana-ai/zcc-plugin-sdk/server';
import type { DocActor } from '../shared/contract.js';
import { runCli, type CliDeps } from './cli.js';
import { createDoc, updateDoc, type OperationContext } from './operations.js';
import { assertRegisteredProject, resolveNamedProject } from './project-guard.js';
import { createRpcHandlers } from './rpc.js';
import { DesignDocStore } from './store.js';
import { createTestDatabase } from './test-db.js';
import { registerDesignDocTools } from './tools.js';

const PROJECTS = [{ id: 'p1', name: 'App' }, { id: 'p2', name: 'Site' }];
const list = async () => PROJECTS;
const failing = async (): Promise<never> => { throw new Error('host down'); };
const agent: DocActor = { kind: 'agent', label: 'Planner', threadId: 't1' };

describe('assertRegisteredProject', () => {
  it('needs no check without a project', async () => {
    const spy = vi.fn(list);
    await assertRegisteredProject(spy, null);
    await assertRegisteredProject(spy, undefined);
    await assertRegisteredProject(spy, '');
    expect(spy).not.toHaveBeenCalled();
  });
  it('accepts a registered id and rejects an unknown one', async () => {
    await expect(assertRegisteredProject(list, 'p1')).resolves.toBeUndefined();
    await expect(assertRegisteredProject(list, 'nope')).rejects.toThrow(/^unknown project nope$/);
  });
  it('lists valid projects in the hint', async () => {
    await expect(assertRegisteredProject(list, 'nope', { hint: true })).rejects.toThrow(/Valid projects: App \(p1\), Site \(p2\)/);
    await expect(assertRegisteredProject(async () => [{ id: 'x' }], 'nope', { hint: true })).rejects.toThrow(/Valid projects: x$/);
    await expect(assertRegisteredProject(async () => [], 'nope', { hint: true })).rejects.toThrow(/Valid projects: none/);
  });
  it('fails closed when the list throws or is missing', async () => {
    await expect(assertRegisteredProject(failing, 'p1')).rejects.toMatchObject({ code: 'invalid' });
    await expect(assertRegisteredProject(undefined, 'p1')).rejects.toThrow(/unavailable/);
  });
});

describe('resolveNamedProject', () => {
  it('maps input to undefined, null or a verified id', async () => {
    expect(await resolveNamedProject(list, {})).toBeUndefined();
    expect(await resolveNamedProject(list, { projectId: null })).toBeUndefined();
    expect(await resolveNamedProject(list, { global: true })).toBeNull();
    expect(await resolveNamedProject(list, { global: 'true' })).toBeNull();
    expect(await resolveNamedProject(list, { projectId: 'p2', global: false })).toBe('p2');
  });
  it('rejects both, bad types, unknown ids and list failure', async () => {
    await expect(resolveNamedProject(list, { projectId: 'p1', global: true })).rejects.toThrow(/not both/);
    await expect(resolveNamedProject(list, { projectId: 7 })).rejects.toThrow(/non-empty string/);
    await expect(resolveNamedProject(list, { projectId: ' ' })).rejects.toThrow(/non-empty string/);
    await expect(resolveNamedProject(list, { projectId: 'nope' })).rejects.toThrow(/Valid projects/);
    await expect(resolveNamedProject(failing, { projectId: 'p1' })).rejects.toThrow(/unavailable/);
    expect(await resolveNamedProject(failing, { global: true })).toBeNull();
  });
});

describe('named project on the operations, tool and CLI paths', () => {
  function setup(listProjects: OperationContext['listProjects'] = list) {
    const store = new DesignDocStore(createTestDatabase());
    const changed = vi.fn();
    const ctx: OperationContext = { store, changed, projectId: 'p1', listProjects };
    return { store, changed, ctx };
  }

  it('operations: create global / named / default, move, and refuse bad input', async () => {
    const { ctx, store } = setup();
    const idOf = (text: string) => /dd_\w+/.exec(text)![0];
    expect(store.summary(idOf(await createDoc(ctx, { title: 'Def' }, agent))).projectId).toBe('p1');
    expect(store.summary(idOf(await createDoc(ctx, { title: 'Glob', global: true }, agent))).projectId).toBeNull();
    const named = idOf(await createDoc(ctx, { title: 'Named', projectId: 'p2' }, agent));
    expect(store.summary(named).projectId).toBe('p2');
    await updateDoc(ctx, { doc: named, projectId: 'p1' }, agent);
    expect(store.summary(named).projectId).toBe('p1');
    await updateDoc(ctx, { doc: named, global: true }, agent);
    expect(store.summary(named).projectId).toBeNull();
    await updateDoc(ctx, { doc: named, title: 'Renamed' }, agent);
    expect(store.summary(named).projectId).toBeNull();
    await expect(createDoc(ctx, { title: 'x', projectId: 'nope' }, agent)).rejects.toThrow(/Valid projects: App \(p1\)/);
    await expect(createDoc(ctx, { title: 'x', projectId: 'p1', global: true }, agent)).rejects.toThrow(/not both/);
    await expect(updateDoc(ctx, { doc: named, projectId: 'nope' }, agent)).rejects.toThrow(/unknown project nope/);
    await expect(updateDoc(ctx, { doc: named, projectId: 'p1', global: true }, agent)).rejects.toThrow(/not both/);
    expect(store.summary(named).projectId).toBeNull();
  });

  it('operations: list failure or missing lister refuses a named project but not global', async () => {
    const down = setup(failing);
    await expect(createDoc(down.ctx, { title: 'x', projectId: 'p2' }, agent)).rejects.toThrow(/unavailable/);
    expect(down.store.list({}).length).toBe(0);
    await createDoc(down.ctx, { title: 'g', global: true }, agent);
    const none = setup();
    await expect(createDoc({ ...none.ctx, listProjects: undefined }, { title: 'x', projectId: 'p2' }, agent)).rejects.toThrow(/unavailable/);
  });

  it('tools: schemas expose projectId and global; execute verifies', async () => {
    const { store, changed } = setup();
    const tools: any[] = [];
    registerDesignDocTools({ agents: { registerTool: (t: unknown) => tools.push(t) } } as never,
      { store, changed, actorFor: async () => agent, listProjects: list });
    const create = tools.find((t) => t.name === 'design_doc_create');
    const update = tools.find((t) => t.name === 'design_doc_update');
    expect(create.parameters.properties.projectId.type).toBe('string');
    expect(update.parameters.properties.projectId.type).toBe('string');
    expect(update.parameters.properties.global.type).toBe('boolean');
    const text: string = await create.execute({ title: 'T', projectId: 'p2' }, { threadId: 't1', projectId: 'p1' });
    const id = /dd_\w+/.exec(text)![0];
    expect(store.summary(id).projectId).toBe('p2');
    await update.execute({ doc: id, global: true }, { threadId: 't1', projectId: 'p1' });
    expect(store.summary(id).projectId).toBeNull();
    await update.execute({ doc: id, projectId: 'p1' }, { threadId: 't1', projectId: 'p1' });
    expect(store.summary(id).projectId).toBe('p1');
    await expect(create.execute({ title: 'T', projectId: 'nope' }, { threadId: 't1' })).rejects.toThrow(/Valid projects: App \(p1\), Site \(p2\)/);
    await expect(update.execute({ doc: id, projectId: 'p2', global: true }, { threadId: 't1' })).rejects.toThrow(/not both/);
    expect(store.summary(id).projectId).toBe('p1');
  });

  it('tools: fail closed when the project list fetch fails', async () => {
    const { store, changed } = setup();
    const tools: any[] = [];
    registerDesignDocTools({ agents: { registerTool: (t: unknown) => tools.push(t) } } as never,
      { store, changed, actorFor: async () => agent, listProjects: failing });
    const create = tools.find((t) => t.name === 'design_doc_create');
    await expect(create.execute({ title: 'T', projectId: 'p2' }, { threadId: 't1' })).rejects.toThrow(/unavailable/);
    expect(changed).not.toHaveBeenCalled();
  });

  describe('CLI', () => {
    function cli(listProjects: CliDeps['listProjects'] = list) {
      const { store, changed } = setup();
      const deps: CliDeps = {
        store, changed, listProjects,
        caller: async (c) => ({ actor: agent, projectId: c.projectId ?? null, files: null }),
        readLocalFile: vi.fn()
      };
      const run = (argv: string[]) => runCli(deps, argv, { pluginId: 'design-docs', argv, projectId: 'p1' } as PluginCliContext);
      return { store, run };
    }
    it('creates in a named project, global, and moves with --project / --global', async () => {
      const { store, run } = cli();
      const made = await run(['create', '--title', 'N', '--project', 'p2']);
      expect(made.exitCode).toBe(0);
      const id = /dd_\w+/.exec(made.stdout!)![0];
      expect(store.summary(id).projectId).toBe('p2');
      expect((await run(['update', id, '--project', 'p1'])).exitCode).toBe(0);
      expect(store.summary(id).projectId).toBe('p1');
      expect((await run(['update', id, '--global'])).exitCode).toBe(0);
      expect(store.summary(id).projectId).toBeNull();
      const g = await run(['create', '--title', 'G', '--global']);
      expect(store.summary(/dd_\w+/.exec(g.stdout!)![0]).projectId).toBeNull();
    });
    it('rejects unknown ids, both flags and a failed list', async () => {
      const { store, run } = cli();
      expect(await run(['create', '--title', 'x', '--project', 'nope'])).toMatchObject({ exitCode: 2, stderr: expect.stringContaining('Valid projects') });
      expect(await run(['create', '--title', 'x', '--project', 'p1', '--global'])).toMatchObject({ exitCode: 2, stderr: expect.stringContaining('not both') });
      expect(store.list({}).length).toBe(0);
      const made = await run(['create', '--title', 'ok']);
      const id = /dd_\w+/.exec(made.stdout!)![0];
      expect(await run(['update', id, '--project', 'p1', '--global'])).toMatchObject({ exitCode: 2 });
      expect(await run(['update', id, '--project', 'nope'])).toMatchObject({ exitCode: 2 });
      const down = cli(failing);
      expect(await down.run(['create', '--title', 'x', '--project', 'p2'])).toMatchObject({ exitCode: 2, stderr: expect.stringContaining('unavailable') });
      expect(down.store.list({}).length).toBe(0);
    });
  });

  it('RPC: a renderer-supplied unknown id is rejected by main, a failed list rejects, known id applies', async () => {
    const store = new DesignDocStore(createTestDatabase());
    const sdk = { projects: { list: vi.fn(list) } };
    const rpc = createRpcHandlers({ store, changed: vi.fn(), sdk } as never);
    await expect(rpc.create!({ title: 'x', projectId: 'p-unknown' })).rejects.toThrow(/unknown project p-unknown/);
    const doc: any = await rpc.create!({ title: 'x', projectId: 'p2' });
    expect(doc.projectId).toBe('p2');
    sdk.projects.list.mockRejectedValueOnce(new Error('down'));
    await expect(rpc.update!({ doc: doc.id, projectId: 'p1' })).rejects.toMatchObject({ code: 'invalid' });
    expect(store.summary(doc.id).projectId).toBe('p2');
  });
});
