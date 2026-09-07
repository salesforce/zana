import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProductHttpContext } from '../../http/product-context.js';
import { invokeHostSessionTool, isHostSessionTool, mergeHostSessionTooling } from './host-session-tools.js';
import { setBrowserAutomationHost, type BrowserAutomationHost } from './browser-automation.js';
import { HOST_PREVIEW_FILE_TOOL_NAME } from './host-preview-file-tool.js';

function hub() {
  const events: Array<{ type: string; payload: unknown }> = [];
  return {
    events,
    emit(type: string, payload: unknown) {
      events.push({ type, payload });
    },
    size() {
      return 1;
    }
  };
}

function ctx(over: Partial<ProductHttpContext> = {}): ProductHttpContext {
  const bus = hub();
  return {
    toProjects: () => [],
    config: { getConfig: () => ({}) },
    hub: bus,
    inbox: {
      append: async () => ({ id: 'inb-1', ts: 1, projectId: 'proj-1' }),
      read: async () => ({ entries: [], hasMore: false })
    },
    suggestions: {
      append: async () => ({ id: 'sug-1' })
    },
    projects: {
      add: async (path: string) => ({ id: 'new-proj', name: 'new', path }),
      list: () => []
    },
    ...over
  } as unknown as ProductHttpContext;
}

const stubHost: BrowserAutomationHost = {
  open: async () => ({ targetId: 'tgt_1', tabId: 'browser:1' }),
  list: async () => [{ targetId: 'tgt_1', tabId: 'browser:1', url: 'https://a.test', title: 'A' }],
  snapshot: async () => ({
    targetId: 'tgt_1',
    tabId: 'browser:1',
    url: 'https://a.test',
    title: 'A',
    dataUrl: null
  }),
  click: async () => undefined,
  type: async () => undefined,
  evaluate: async () => 'ok',
  close: async () => undefined
};

afterEach(() => {
  setBrowserAutomationHost(null);
});

describe('invokeHostSessionTool', () => {
  it('answers inbox_push from the owning thread and ignores a forged projectId', async () => {
    const append = vi.fn(async (input: { projectId: string; sessionId?: string }) => ({
      id: 'inb-1',
      ts: 2,
      projectId: input.projectId
    }));
    const result = await invokeHostSessionTool(ctx({ inbox: { append, read: async () => ({ entries: [], hasMore: false }) } } as never), {
      name: 'inbox_push',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { comments: 'done', projectId: 'other-proj', options: [{ label: 'A' }] }
    });
    expect(result.success).toBe(true);
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'proj-1',
      sessionId: 'thr-1',
      comments: 'done'
    }));
    expect(append.mock.calls[0]?.[0]).not.toHaveProperty('question');
  });

  it('opens a browser tab on the owning thread and ignores a forged threadId', async () => {
    const open = vi.fn(async () => ({ targetId: 'tgt_1', tabId: 'browser:1' }));
    setBrowserAutomationHost({ ...stubHost, open });
    const result = await invokeHostSessionTool(ctx(), {
      name: 'browser_open',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { url: 'https://a.test', threadId: 'other-thread' }
    });
    expect(result.success).toBe(true);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thr-1', url: 'https://a.test' }));
  });

  it('falls back to a hub event when browser automation is not in-process', async () => {
    const product = ctx();
    const result = await invokeHostSessionTool(product, {
      name: 'browser_open',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { url: 'https://a.test' }
    });
    expect(result.success).toBe(true);
    expect((product.hub as unknown as { events: Array<{ type: string }> }).events[0]?.type).toBe('threads:browser');
    const closed = ctx();
    (closed.hub as unknown as { size: () => number }).size = () => 0;
    const undelivered = await invokeHostSessionTool(closed, {
      name: 'browser_open',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { url: 'https://a.test' }
    });
    expect(undelivered.success).toBe(false);
  });

  it('lists and writes library docs under the owning project', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-lib-'));
    const product = ctx({
      toProjects: () => [{ id: 'proj-1', name: 'Demo', path: root }]
    });
    const written = await invokeHostSessionTool(product, {
      name: 'library_write',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { relPath: 'findings/note.md', title: 'Note', content: 'hello' }
    });
    expect(written.success).toBe(true);
    const listed = await invokeHostSessionTool(product, {
      name: 'library_list',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: {}
    });
    expect(JSON.parse(listed.contentItems[0]?.text ?? '[]')).toEqual([
      expect.objectContaining({ relPath: 'findings/note.md', title: 'Note' })
    ]);
    const escaped = await invokeHostSessionTool(product, {
      name: 'library_write',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { relPath: '../secret.md', content: 'nope' }
    });
    expect(escaped.success).toBe(false);
    const read = await invokeHostSessionTool(product, {
      name: 'library_read',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { relPath: 'findings/note.md' }
    });
    expect(JSON.parse(read.contentItems[0]?.text ?? '{}').content).toBe('hello');
    const removed = await invokeHostSessionTool(product, {
      name: 'library_remove',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { relPath: 'findings/note.md' }
    });
    expect(removed.success).toBe(true);
    const missing = await invokeHostSessionTool(product, {
      name: 'library_read',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { relPath: 'findings/note.md' }
    });
    expect(missing.success).toBe(false);
    const unknownProject = await invokeHostSessionTool(ctx(), {
      name: 'library_list',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: {}
    });
    expect(unknownProject.success).toBe(false);
  });

  it('creates and lists a project-scoped goal', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-goal-'));
    const product = ctx({
      toProjects: () => [{ id: 'proj-1', name: 'Demo', path: root }]
    });
    const created = await invokeHostSessionTool(product, {
      name: 'goal_create',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { title: 'Green suite', statement: 'npm test passes', successCriteria: ['npm test exits 0'] }
    });
    expect(created.success).toBe(true);
    const listed = await invokeHostSessionTool(product, {
      name: 'goal_list',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: {}
    });
    const goals = JSON.parse(listed.contentItems[0]?.text ?? '[]') as Array<{ title: string; projectId?: string }>;
    expect(goals).toEqual([expect.objectContaining({ title: 'Green suite' })]);
  });

  it('lists schedules for this project and emits run-now on the hub', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-sched-'));
    const dir = join(root, '.zcc', 'schedules');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'sched-1.json'), JSON.stringify({
      id: 'sched-1',
      name: 'Hourly QA',
      enabled: true,
      projectId: 'proj-1',
      profile: 'claude-yolo',
      schedule: { every: '1h' },
      status: { runCount: 0, runs: [] },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }));
    const product = ctx({
      toProjects: () => [{ id: 'proj-1', name: 'Demo', path: root }]
    });
    const listed = await invokeHostSessionTool(product, {
      name: 'schedule_list',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: {}
    });
    const body = JSON.parse(listed.contentItems[0]?.text ?? '{}') as { schedules: Array<{ id: string }> };
    expect(body.schedules).toEqual([expect.objectContaining({ id: 'sched-1' })]);
    const ran = await invokeHostSessionTool(product, {
      name: 'schedule_run_now',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { id: 'sched-1' }
    });
    expect(ran.success).toBe(true);
    expect((product.hub as unknown as { events: Array<{ type: string; payload: { id: string } }> }).events)
      .toContainEqual({ type: 'scheduler:command', payload: { action: 'run-now', id: 'sched-1' } });
    const toggled = await invokeHostSessionTool(product, {
      name: 'schedule_set_enabled',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { id: 'sched-1', enabled: false }
    });
    expect(toggled.success).toBe(true);
  });

  it('answers inbox_search and suggest_action', async () => {
    const read = vi.fn(async () => ({
      entries: [
        { id: 'e1', ts: 1, projectId: 'proj-1', comments: 'shipped auth', docs: [{ path: 'docs/a.md' }] }
      ],
      hasMore: false
    }));
    const append = vi.fn(async () => ({ id: 'sug-9' }));
    const product = ctx({
      inbox: { append: async () => ({ id: 'x', ts: 1, projectId: 'proj-1' }), read },
      suggestions: { append }
    } as never);
    const searched = await invokeHostSessionTool(product, {
      name: 'inbox_search',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { query: 'auth' }
    });
    expect(searched.success).toBe(true);
    expect(JSON.parse(searched.contentItems[0]?.text ?? '{}').count).toBe(1);
    const suggested = await invokeHostSessionTool(product, {
      name: 'suggest_action',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: {
        title: 'Review',
        reason: 'CI is green — ready for a review pass',
        action: { kind: 'start-agent', prompt: 'review the diff' }
      }
    });
    expect(suggested.success).toBe(true);
    expect(append).toHaveBeenCalled();
    const rejected = await invokeHostSessionTool(product, {
      name: 'suggest_action',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { title: 'Go', reason: 'just navigate', action: { kind: 'open-view', nav: 'inbox' } }
    });
    expect(rejected.success).toBe(false);
  });

  it('drives browser snapshot/click/type/eval/close through the desktop host', async () => {
    const host = {
      ...stubHost,
      snapshot: vi.fn(stubHost.snapshot),
      click: vi.fn(stubHost.click),
      type: vi.fn(stubHost.type),
      evaluate: vi.fn(stubHost.evaluate),
      close: vi.fn(stubHost.close),
      list: vi.fn(stubHost.list)
    };
    setBrowserAutomationHost(host);
    const product = ctx();
    expect((await invokeHostSessionTool(product, {
      name: 'browser_list', threadId: 'thr-1', projectId: 'proj-1', input: {}
    })).success).toBe(true);
    expect(host.list).toHaveBeenCalledWith('thr-1');
    expect((await invokeHostSessionTool(product, {
      name: 'browser_snapshot', threadId: 'thr-1', projectId: 'proj-1', input: { targetId: 'tgt_1' }
    })).success).toBe(true);
    expect(host.snapshot).toHaveBeenCalledWith('tgt_1', 'thr-1');
    expect((await invokeHostSessionTool(product, {
      name: 'browser_click', threadId: 'thr-1', projectId: 'proj-1', input: { targetId: 'tgt_1', selector: 'button' }
    })).success).toBe(true);
    expect(host.click).toHaveBeenCalledWith('tgt_1', expect.objectContaining({ selector: 'button' }), 'thr-1');
    expect((await invokeHostSessionTool(product, {
      name: 'browser_type', threadId: 'thr-1', projectId: 'proj-1', input: { targetId: 'tgt_1', text: 'hi' }
    })).success).toBe(true);
    expect(host.type).toHaveBeenCalledWith('tgt_1', expect.objectContaining({ text: 'hi' }), 'thr-1');
    expect((await invokeHostSessionTool(product, {
      name: 'browser_eval', threadId: 'thr-1', projectId: 'proj-1', input: { targetId: 'tgt_1', script: '1+1' }
    })).success).toBe(true);
    expect(host.evaluate).toHaveBeenCalledWith('tgt_1', '1+1', 'thr-1');
    expect((await invokeHostSessionTool(product, {
      name: 'browser_close', threadId: 'thr-1', projectId: 'proj-1', input: { targetId: 'tgt_1' }
    })).success).toBe(true);
    expect(host.close).toHaveBeenCalledWith('tgt_1', 'thr-1');
    setBrowserAutomationHost(null);
    const missing = await invokeHostSessionTool(ctx(), {
      name: 'browser_snapshot',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { targetId: 'tgt_1' }
    });
    expect(missing.success).toBe(false);
  });

  it('reports unsupported for names that are not host SHARE tools', async () => {
    expect(isHostSessionTool('inbox_ask')).toBe(false);
    expect(isHostSessionTool(HOST_PREVIEW_FILE_TOOL_NAME)).toBe(true);
    const packed = mergeHostSessionTooling({
      dynamicTools: [{ name: 'sf_soql', description: 'SOQL', inputSchema: {} }]
    });
    expect(packed.dynamicTools?.at(-1)?.name).toBe('sf_soql');
    const result = await invokeHostSessionTool(ctx(), {
      name: 'inbox_ask',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: {}
    });
    expect(result.success).toBe(false);
    expect(result.contentItems[0]?.text).toContain('Unsupported tool');
  });
});
