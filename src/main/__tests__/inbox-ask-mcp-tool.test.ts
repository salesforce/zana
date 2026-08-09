import { describe, it, expect } from 'vitest';
import { registerInboxAskTool, type RegisterInboxAskOpts } from '../inbox-ask-mcp-tool.js';
import { createMemoryInboxStore, type IInboxStore } from '../inbox-store.js';

/**
 * Minimal fake McpServer that captures the registered handler so we can invoke
 * it directly without an HTTP transport. Mirrors inbox-search-mcp-tool.test.ts.
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

function register(store: IInboxStore, over: Partial<RegisterInboxAskOpts> = {}) {
  const { server, tools } = fakeServer();
  registerInboxAskTool(server as never, {
    projectId: 'p1',
    sessionId: 's1',
    inboxStore: store,
    ...over
  });
  return tools.get('inbox_ask')!;
}

describe('registerInboxAskTool', () => {
  it('registers an inbox_ask tool', () => {
    const { server, tools } = fakeServer();
    registerInboxAskTool(server as never, {
      projectId: 'p1',
      sessionId: 's1',
      inboxStore: createMemoryInboxStore()
    });
    expect([...tools.keys()]).toEqual(['inbox_ask']);
  });

  it('writes an entry whose comments hold the prompt and question holds the options', async () => {
    const store = createMemoryInboxStore();
    await register(store)({
      question: 'Which approach?',
      options: ['Rewrite', 'Patch in place']
    });
    const { entries } = await store.read({ projectId: 'p1' });
    expect(entries).toHaveLength(1);
    expect(entries[0].comments).toBe('Which approach?');
    expect(entries[0].sessionId).toBe('s1');
    expect(entries[0].question?.options).toEqual([
      { id: 'A', label: 'Rewrite' },
      { id: 'B', label: 'Patch in place' }
    ]);
  });

  it('threads an author-set subject onto a single-question entry', async () => {
    const store = createMemoryInboxStore();
    await register(store)({
      question: 'Which approach?',
      options: ['Rewrite', 'Patch in place'],
      subject: 'Approach decision'
    });
    const { entries } = await store.read({ projectId: 'p1' });
    expect(entries[0].subject).toBe('Approach decision');
  });

  it('threads an author-set subject onto a multi-question entry', async () => {
    const store = createMemoryInboxStore();
    await register(store)({
      questions: [{ prompt: 'Ship today?', options: ['Yes', 'No'] }],
      subject: 'Release checklist'
    });
    const { entries } = await store.read({ projectId: 'p1' });
    expect(entries[0].subject).toBe('Release checklist');
    expect(entries[0].questions).toHaveLength(1);
  });

  it('host-assigns sequential letter ids the agent cannot forge', async () => {
    const store = createMemoryInboxStore();
    await register(store)({
      question: 'Pick one',
      options: ['one', 'two', 'three']
    });
    const { entries } = await store.read({ projectId: 'p1' });
    expect(entries[0].question?.options.map((o) => o.id)).toEqual(['A', 'B', 'C']);
  });

  it('passes through allowOther / multiSelect, omitting them when false', async () => {
    const store = createMemoryInboxStore();
    await register(store)({
      question: 'q',
      options: ['a'],
      allowOther: true,
      multiSelect: false
    });
    const { entries } = await store.read({ projectId: 'p1' });
    expect(entries[0].question?.allowOther).toBe(true);
    expect(entries[0].question?.multiSelect).toBeUndefined();
  });

  it('forces a scheduled question loud so it never lands in the quiet group', async () => {
    const store = createMemoryInboxStore();
    await register(store, { scheduled: true, notify: 'quiet' })({
      question: 'Need a decision',
      options: ['yes', 'no']
    });
    const { entries } = await store.read({ projectId: 'p1' });
    expect(entries[0].scheduled).toBe(true);
    expect(entries[0].notify).toBe('loud');
  });

  it('surfaces a store rejection as an error result rather than throwing', async () => {
    const store = createMemoryInboxStore();
    // Direct handler call bypasses the upstream zod schema; an empty prompt AND
    // no options leave the entry with no content, so the store throws. The
    // handler must catch that and report isError, not reject.
    const res = await register(store)({ question: '', options: [] as unknown as string[] });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('inbox_ask failed');
  });

  it('errors when neither question+options nor questions is provided', async () => {
    const store = createMemoryInboxStore();
    const res = await register(store)({});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('inbox_ask failed');
  });

  describe('multi-question mode', () => {
    it('writes a `questions` entry with per-question letters and prompts', async () => {
      const store = createMemoryInboxStore();
      await register(store)({
        preamble: 'A few choices:',
        questions: [
          { prompt: 'Which database?', options: ['Postgres', 'SQLite'], allowOther: true },
          { prompt: 'Deploy target?', options: ['Docker', 'Bare metal', 'Serverless'] }
        ]
      });
      const { entries } = await store.read({ projectId: 'p1' });
      expect(entries).toHaveLength(1);
      // The preamble becomes the card's shared header (comments).
      expect(entries[0].comments).toBe('A few choices:');
      // Single-question field stays unset in multi mode.
      expect(entries[0].question).toBeUndefined();
      expect(entries[0].questions).toHaveLength(2);
      expect(entries[0].questions?.[0].prompt).toBe('Which database?');
      expect(entries[0].questions?.[0].allowOther).toBe(true);
      // Letters are assigned PER question (both restart at A).
      expect(entries[0].questions?.[0].options.map((o) => o.id)).toEqual(['A', 'B']);
      expect(entries[0].questions?.[1].options.map((o) => o.id)).toEqual(['A', 'B', 'C']);
    });

    it('reports how many questions were asked', async () => {
      const store = createMemoryInboxStore();
      const res = await register(store)({
        questions: [
          { prompt: 'One?', options: ['a', 'b'] },
          { prompt: 'Two?', options: ['c', 'd'] }
        ]
      });
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain('2 questions');
    });

    it('works with no preamble (per-question prompts carry the text)', async () => {
      const store = createMemoryInboxStore();
      await register(store)({
        questions: [{ prompt: 'Only question?', options: ['yes', 'no'] }]
      });
      const { entries } = await store.read({ projectId: 'p1' });
      expect(entries[0].comments).toBeUndefined();
      expect(entries[0].questions).toHaveLength(1);
    });
  });
});
