import { describe, it, expect } from 'vitest';
import {
  registerInboxSearchTool,
  INBOX_SEARCH_DEFAULT_LIMIT,
  type RegisterInboxSearchOpts
} from '../inbox-search-mcp-tool.js';
import { createMemoryInboxStore, type IInboxStore } from '../inbox-store.js';

/**
 * Minimal fake McpServer that captures the registered handler so we can invoke
 * it directly without an HTTP transport. Mirrors the library-mcp-tools test.
 */
type ToolHandler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
}>;

function fakeServer() {
  const tools = new Map<string, ToolHandler>();
  const server = {
    registerTool: (name: string, _def: unknown, handler: ToolHandler) => {
      tools.set(name, handler);
    }
  };
  return { server, tools };
}

function payload(res: { content: Array<{ type: string; text?: string }> }) {
  return JSON.parse(res.content.find((c) => c.type === 'text')?.text ?? '{}');
}

async function seed(store: IInboxStore) {
  await store.append({ projectId: 'p1', comments: 'Finished the migration audit' });
  await store.append({ projectId: 'p1', comments: 'Deploy failed on staging' });
  await store.append({ projectId: 'p1', docs: [{ path: 'reports/macro-2026.md' }] });
  await store.append({ projectId: 'p2', comments: 'Other project migration note' });
}

function register(store: IInboxStore, over: Partial<RegisterInboxSearchOpts> = {}) {
  const { server, tools } = fakeServer();
  registerInboxSearchTool(server as never, { projectId: 'p1', inboxStore: store, ...over });
  return tools.get('inbox_search')!;
}

describe('registerInboxSearchTool', () => {
  it('registers an inbox_search tool', () => {
    const { server, tools } = fakeServer();
    registerInboxSearchTool(server as never, { projectId: 'p1', inboxStore: createMemoryInboxStore() });
    expect([...tools.keys()]).toEqual(['inbox_search']);
  });

  it('defaults to THIS project only — never another project, even with no query', async () => {
    const store = createMemoryInboxStore();
    await seed(store);
    const out = payload(await register(store)({}));
    expect(out.scope).toBe('project:p1');
    expect(out.entries.every((e: { projectId: string }) => e.projectId === 'p1')).toBe(true);
    // The p2 entry is invisible to a p1-scoped agent.
    expect(out.entries.some((e: { comments?: string }) => e.comments?.includes('Other project'))).toBe(
      false
    );
  });

  it('substring-matches comments case-insensitively', async () => {
    const store = createMemoryInboxStore();
    await seed(store);
    const out = payload(await register(store)({ query: 'MIGRATION' }));
    expect(out.query).toBe('migration');
    expect(out.count).toBe(1);
    expect(out.entries[0].comments).toContain('migration audit');
  });

  it('matches against the subject and projects it into the hit', async () => {
    const store = createMemoryInboxStore();
    await store.append({ projectId: 'p1', comments: 'body text', subject: 'Quarterly rollup' });
    const out = payload(await register(store)({ query: 'quarterly' }));
    expect(out.count).toBe(1);
    expect(out.entries[0].subject).toBe('Quarterly rollup');
  });

  it('also matches against doc paths', async () => {
    const store = createMemoryInboxStore();
    await seed(store);
    const out = payload(await register(store)({ query: 'macro-2026' }));
    expect(out.count).toBe(1);
    expect(out.entries[0].docs).toEqual(['reports/macro-2026.md']);
  });

  it('widens to all projects only when allProjects:true', async () => {
    const store = createMemoryInboxStore();
    await seed(store);
    const out = payload(await register(store)({ query: 'migration', allProjects: true }));
    expect(out.scope).toBe('all-projects');
    expect(out.count).toBe(2);
    const ids = out.entries.map((e: { projectId: string }) => e.projectId).sort();
    expect(ids).toEqual(['p1', 'p2']);
  });

  it('ignores any agent-supplied projectId — scope comes from the route', async () => {
    const store = createMemoryInboxStore();
    await seed(store);
    // A forged projectId in the args must have no effect (the schema doesn't
    // accept it, and the handler closes over the route id).
    const out = payload(await register(store, { projectId: 'p1' })({ projectId: 'p2' }));
    expect(out.scope).toBe('project:p1');
    expect(out.entries.every((e: { projectId: string }) => e.projectId === 'p1')).toBe(true);
  });

  it('caps results at limit and flags hasMore when truncated', async () => {
    const store = createMemoryInboxStore();
    for (let i = 0; i < 5; i++) await store.append({ projectId: 'p1', comments: `note ${i}` });
    const out = payload(await register(store)({ limit: 2 }));
    expect(out.count).toBe(2);
    expect(out.hasMore).toBe(true);
  });

  it('returns recent entries newest-first when no query is given', async () => {
    const store = createMemoryInboxStore();
    await seed(store);
    const out = payload(await register(store)({}));
    // Newest first: the macro-doc entry was appended last for p1.
    expect(out.entries[0].docs).toEqual(['reports/macro-2026.md']);
    expect(out.count).toBeLessThanOrEqual(INBOX_SEARCH_DEFAULT_LIMIT);
  });

  it('reports an empty result set (not an error) when nothing matches', async () => {
    const store = createMemoryInboxStore();
    await seed(store);
    const res = await register(store)({ query: 'no-such-text' });
    expect(res.isError).toBeUndefined();
    expect(payload(res).count).toBe(0);
  });
});
