import { describe, expect, it, vi } from 'vitest';
import type { DocActor } from '../shared/contract.js';
import { INSTRUCTION_BUDGET, buildInstructions, registerAgentContext } from './context.js';
import { DesignDocStore } from './store.js';
import { createTestDatabase } from './test-db.js';

const user: DocActor = { kind: 'user', label: 'You', threadId: null };

function capture(store: DesignDocStore, log = vi.fn()) {
  let instructions: ((ctx: { threadId: string; projectId: string }) => string | null) | undefined;
  let mention: any;
  registerAgentContext(
    {
      agents: { contributeInstructions: (provider: typeof instructions) => (instructions = provider) },
      ui: { registerMentionProvider: (provider: unknown) => (mention = provider) }
    } as never,
    store,
    log
  );
  return { instructions: instructions!, mention, log };
}

describe('agent instructions', () => {
  it('teaches the tools even before any doc exists', () => {
    const text = buildInstructions(new DesignDocStore(createTestDatabase()), 'p1');
    expect(text).toContain('design_doc_*');
    expect(text).toContain('::design-doc{id="<id>"}');
    expect(text).toMatch(/no design docs for this project yet\.$/);
  });

  it('lists active project + global docs and stays inside the budget', () => {
    const store = new DesignDocStore(createTestDatabase());
    store.create({ title: 'Hidden', projectId: 'p2', template: 'blank' }, user);
    const archived = store.create({ title: 'Old', projectId: 'p1', template: 'blank' }, user);
    store.update(archived.id, { status: 'archived' }, user);
    const doc = store.create({ title: 'Sync', projectId: 'p1', summary: 'Offline first', template: 'blank' }, user);
    store.addComment(doc.id, { body: 'x' }, user);
    store.create({ title: 'Global', template: 'blank' }, user);

    const text = buildInstructions(store, 'p1');
    expect(text).toContain(`- ${doc.id} "Sync" (Draft · 1 open comment) — Offline first`);
    expect(text).toContain('"Global"');
    expect(text).not.toContain('Hidden');
    expect(text).not.toContain('"Old"');

    for (let index = 0; index < 14; index += 1) {
      store.create({ title: `Doc ${index} ${'w'.repeat(120)}`, projectId: 'p1', summary: 's'.repeat(500), template: 'blank' }, user);
    }
    const crowded = buildInstructions(store, 'p1');
    expect(crowded.length).toBeLessThanOrEqual(INSTRUCTION_BUDGET);
    expect(crowded).toMatch(/- … more: call design_doc_list$/);
  });

  it('degrades to no instructions when the store fails', () => {
    const store = new DesignDocStore(createTestDatabase());
    const { instructions, log } = capture(store);
    expect(instructions({ threadId: 't', projectId: 'p1' })).toContain('## Design docs');
    vi.spyOn(store, 'list').mockImplementation(() => {
      throw new Error('db closed');
    });
    expect(instructions({ threadId: 't', projectId: 'p1' })).toBeNull();
    expect(log).toHaveBeenCalledWith('design docs instructions failed: db closed');
  });
});

describe('@ mentions', () => {
  it('searches active docs in the project and resolves one into context', () => {
    const store = new DesignDocStore(createTestDatabase());
    const doc = store.create({ title: 'Payments', projectId: 'p1', template: 'technical' }, user);
    store.create({ title: 'Payments elsewhere', projectId: 'p2', template: 'blank' }, user);
    const { mention } = capture(store);
    expect(mention).toMatchObject({ id: 'design-doc', label: 'Design docs' });
    expect(mention.search({ query: 'pay', projectId: 'p1' })).toEqual([{ id: doc.id, label: 'Payments · Draft' }]);
    expect(mention.search('pay')).toHaveLength(2);

    const { context } = mention.resolve(doc.id);
    expect(context).toMatch(new RegExp(`^The user referenced design doc ${doc.id}`));
    expect(context).toContain('<file path="README.md"');
    expect(context).not.toContain('truncated');
  });

  it('truncates a very large entry file', () => {
    const store = new DesignDocStore(createTestDatabase());
    const doc = store.create({ title: 'Big', files: [{ path: 'README.md', content: 'x'.repeat(30_000) }] }, user);
    const { mention } = capture(store);
    expect(mention.resolve(doc.id).context).toContain('(truncated — read the rest with design_doc_read)');
  });
});
