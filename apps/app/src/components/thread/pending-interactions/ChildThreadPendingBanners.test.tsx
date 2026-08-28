import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { PendingInteraction } from '@zana-ai/zcc-domain/thread-runtime';
import { ChildThreadPendingBanners } from './ChildThreadPendingBanners.js';

vi.mock('../../../lib/product-client.js', () => ({
  product: {
    threads: {
      interactions: {
        resolve: vi.fn(),
        respond: vi.fn(),
        cancel: vi.fn()
      }
    }
  }
}));

vi.mock('./useOpenPendingInteractions.js', () => ({
  useOpenPendingInteractions: (threadId: string) => threadId === 'thr-child' ? [childInteraction()] : []
}));

function childInteraction(): PendingInteraction {
  return {
    id: 'pint_child',
    threadId: 'thr-child',
    turnId: 'turn-1',
    providerId: 'claude-code',
    providerThreadId: 'prov-1',
    providerRequestId: 'req-1',
    origin: {
      kind: 'provider',
      providerId: 'claude-code',
      providerThreadId: 'prov-1',
      providerRequestId: 'req-1'
    },
    status: 'pending',
    payload: {
      kind: 'approval',
      reason: 'Needs approval',
      availableDecisions: ['deny'],
      subject: {
        kind: 'command',
        itemId: 'item-1',
        command: 'rm -rf',
        cwd: '/tmp',
        actions: [],
        sessionGrant: null
      }
    },
    resolution: null,
    statusReason: null,
    createdAt: 1,
    resolvedAt: null
  };
}

describe('ChildThreadPendingBanners', () => {
  it('renders a source-thread banner for children with open interactions', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ChildThreadPendingBanners
          childThreads={[
            { id: 'thr-child', title: ' Investigate ' },
            { id: 'thr-quiet', title: 'Idle' }
          ]}
          projectId="proj-1"
        />
      </MemoryRouter>
    );
    expect(html).toContain('From child agent: Investigate');
    expect(html).toContain('rm -rf');
    expect(html).toContain('/projects/proj-1/threads/thr-child');
    expect(html).not.toContain('Idle');
  });

  it('falls back to Child agent when the title is empty', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ChildThreadPendingBanners
          childThreads={[{ id: 'thr-child', title: null }]}
          projectId={null}
        />
      </MemoryRouter>
    );
    expect(html).toContain('From child agent: Child agent');
  });
});
