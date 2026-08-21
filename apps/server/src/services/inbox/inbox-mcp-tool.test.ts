import { describe, it, expect } from 'vitest';
import { registerInboxPushTool, type RegisterInboxPushOpts } from './inbox-mcp-tool.js';
import { createMemoryInboxStore, type IInboxStore } from '@zana-ai/zcc-server';

/** Minimal fake McpServer capturing the handler (mirrors inbox-ask-mcp-tool.test.ts). */
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

function register(store: IInboxStore, over: Partial<RegisterInboxPushOpts> = {}) {
  const { server, tools } = fakeServer();
  registerInboxPushTool(server as never, {
    projectId: 'p1',
    sessionId: 's1',
    inboxStore: store,
    ...over
  });
  return tools.get('inbox_push')!;
}

describe('registerInboxPushTool', () => {
  it('writes a plain status entry with no question fields', async () => {
    const store = createMemoryInboxStore();
    await register(store)({ comments: 'done with the refactor' });
    const { entries } = await store.read({ projectId: 'p1' });
    expect(entries).toHaveLength(1);
    expect(entries[0].comments).toBe('done with the refactor');
    expect(entries[0].question).toBeUndefined();
    expect(entries[0].questions).toBeUndefined();
  });

  it('threads an author-set subject onto the entry', async () => {
    const store = createMemoryInboxStore();
    await register(store)({ comments: 'x', subject: 'Migration audit' });
    const { entries } = await store.read({ projectId: 'p1' });
    expect(entries[0].subject).toBe('Migration audit');
  });

  it('leaves subject undefined on a plain push', async () => {
    const store = createMemoryInboxStore();
    await register(store)({ comments: 'x' });
    const { entries } = await store.read({ projectId: 'p1' });
    expect(entries[0].subject).toBeUndefined();
  });

  it('threads report:true onto the entry when flagged', async () => {
    const store = createMemoryInboxStore();
    await register(store)({ comments: 'RCA done', docs: [{ path: 'rca.md' }], report: true });
    const { entries } = await store.read({ projectId: 'p1' });
    expect(entries[0].report).toBe(true);
  });

  it('leaves report undefined on an unflagged push', async () => {
    const store = createMemoryInboxStore();
    await register(store)({ comments: 'status ping' });
    const { entries } = await store.read({ projectId: 'p1' });
    expect(entries[0].report).toBeUndefined();
  });

  it('attaches a single structured question when options are supplied', async () => {
    const store = createMemoryInboxStore();
    await register(store)({
      comments: 'How do you want to handle the 1.0.1 tag?',
      options: ['Tag now', 'Wait for QA'],
      allowOther: true
    });
    const { entries } = await store.read({ projectId: 'p1' });
    expect(entries[0].comments).toBe('How do you want to handle the 1.0.1 tag?');
    expect(entries[0].question?.options).toEqual([
      { id: 'A', label: 'Tag now' },
      { id: 'B', label: 'Wait for QA' }
    ]);
    expect(entries[0].question?.allowOther).toBe(true);
  });

  it('attaches multiple questions with per-question letters', async () => {
    const store = createMemoryInboxStore();
    await register(store)({
      comments: 'A couple of choices:',
      questions: [
        { prompt: 'Ship today?', options: ['Yes', 'No'] },
        { prompt: 'Which channel?', options: ['stable', 'beta', 'canary'] }
      ]
    });
    const { entries } = await store.read({ projectId: 'p1' });
    expect(entries[0].question).toBeUndefined();
    expect(entries[0].questions).toHaveLength(2);
    expect(entries[0].questions?.[1].options.map((o) => o.id)).toEqual(['A', 'B', 'C']);
  });

  it('normalizes doc paths at push time via normalizeDocPath (fix-at-source)', async () => {
    const store = createMemoryInboxStore();
    // Simulate the resolver rewriting a subdir-relative path to its real
    // project-root-relative location.
    const normalizeDocPath = (p: string) =>
      p === 'CMUX.md' ? 'create-a-project/CMUX.md' : p;
    await register(store, { normalizeDocPath })({
      comments: 'report attached',
      docs: [{ path: 'CMUX.md' }, { path: 'docs/already-correct.md' }]
    });
    const { entries } = await store.read({ projectId: 'p1' });
    expect(entries[0].docs).toEqual([
      { path: 'create-a-project/CMUX.md' },
      { path: 'docs/already-correct.md' }
    ]);
  });

  it('leaves doc paths untouched when no normalizer is wired', async () => {
    const store = createMemoryInboxStore();
    await register(store)({ comments: 'x', docs: [{ path: 'raw.md' }] });
    const { entries } = await store.read({ projectId: 'p1' });
    expect(entries[0].docs).toEqual([{ path: 'raw.md' }]);
  });

  it('a silent scheduled push is suppressed and writes nothing', async () => {
    const store = createMemoryInboxStore();
    const res = await register(store, { scheduled: true, notify: 'silent' })({
      comments: 'ping',
      options: ['a', 'b']
    });
    expect(res.isError).toBeFalsy();
    const { entries } = await store.read({ projectId: 'p1' });
    expect(entries).toHaveLength(0);
  });
});
