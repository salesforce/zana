import { describe, expect, it, vi } from 'vitest';
import type { ProductHttpContext } from '../../http/product-context.js';
import { invokeHostInboxTool } from './host-inbox-tools.js';

function ctx(over: Partial<ProductHttpContext> = {}): ProductHttpContext {
  return {
    toProjects: () => [{ id: 'proj-1', name: 'Demo', path: '/tmp/demo' }],
    inbox: {
      append: async () => ({ id: 'inb-1', ts: 1, projectId: 'proj-1' }),
      read: async () => ({ entries: [], hasMore: false })
    },
    suggestions: { append: async () => ({ id: 'sug-1' }) },
    ...over
  } as unknown as ProductHttpContext;
}

describe('invokeHostInboxTool', () => {
  it('matches subject, intent, and doc paths and can widen to all projects', async () => {
    const read = vi.fn(async () => ({
      entries: [
        { id: 'e1', ts: 1, projectId: 'proj-1', subject: 'Auth RCA', occurrences: 2 },
        { id: 'e2', ts: 2, projectId: 'proj-2', intent: 'unblock deploy', docs: [{ path: 'docs/ship.md' }] }
      ],
      hasMore: true
    }));
    const product = ctx({ inbox: { append: async () => ({ id: 'x', ts: 1, projectId: 'proj-1' }), read } } as never);
    const bySubject = await invokeHostInboxTool(product, {
      name: 'inbox_search',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { query: 'rca', allProjects: true, limit: 1 }
    });
    const body = JSON.parse(bySubject.contentItems[0]?.text ?? '{}') as { scope: string; count: number; hasMore: boolean };
    expect(body.scope).toBe('all-projects');
    expect(body.count).toBe(1);
    expect(body.hasMore).toBe(true);
    const byDocs = await invokeHostInboxTool(product, {
      name: 'inbox_search',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { query: 'ship.md', allProjects: true }
    });
    expect(JSON.parse(byDocs.contentItems[0]?.text ?? '{}').count).toBe(1);
  });

  it('pushes docs and maps store errors', async () => {
    const append = vi.fn(async () => {
      throw new Error('need docs or comments');
    });
    const failed = await invokeHostInboxTool(ctx({
      inbox: { append, read: async () => ({ entries: [], hasMore: false }) }
    } as never), {
      name: 'inbox_push',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { subject: 'only' }
    });
    expect(failed.success).toBe(false);
    const ok = await invokeHostInboxTool(ctx({
      inbox: {
        append: async (input: { docs?: unknown; report?: boolean }) => {
          expect(input.docs).toEqual([{ path: 'docs/a.md' }]);
          expect(input.report).toBe(true);
          return { id: 'inb-2', ts: 3, projectId: 'proj-1' };
        },
        read: async () => ({ entries: [], hasMore: false })
      }
    } as never), {
      name: 'inbox_push',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { docs: [{ path: 'docs/a.md' }], report: true }
    });
    expect(ok.success).toBe(true);
  });
});
