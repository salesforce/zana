import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { PendingInteraction } from '@zana-ai/zcc-domain/thread-runtime';
import { ThreadPendingInteractionBanner } from './ThreadPendingInteractionBanner.js';

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

function commandInteraction(): PendingInteraction {
  return {
    id: 'pint_1',
    threadId: 'thr-1',
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
      availableDecisions: ['allow_once', 'allow_for_session', 'deny'],
      subject: {
        kind: 'command',
        itemId: 'item-1',
        command: 'git push',
        cwd: '/tmp/proj',
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

describe('ThreadPendingInteractionBanner', () => {
  it('renders approval decisions and command details', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadPendingInteractionBanner interaction={commandInteraction()} threadId="thr-1" />
      </MemoryRouter>
    );
    expect(html).toContain('Waiting for approval');
    expect(html).toContain('git push');
    expect(html).toContain('Allow once');
    expect(html).toContain('Allow for session');
    expect(html).toContain('Deny');
    expect(html).toContain('thread-pending-decision-deny');
  });

  it('renders a source-thread link and a question form', () => {
    const question: PendingInteraction = {
      ...commandInteraction(),
      payload: {
        kind: 'user_question',
        questions: [{
          id: 'q1',
          prompt: 'Continue?',
          multiSelect: false,
          allowFreeText: true,
          options: [{ value: 'yes', label: 'Yes' }]
        }]
      }
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadPendingInteractionBanner
          interaction={question}
          threadId="thr-child"
          sourceThread={{ href: '/threads/thr-child', title: 'Child work' }}
        />
      </MemoryRouter>
    );
    expect(html).toContain('From child thread: Child work');
    expect(html).toContain('Continue?');
    expect(html).toContain('thread-pending-question-submit');
    expect(html).toContain('thread-pending-question-input');
  });

  it('renders a plugin banner when the slot is missing', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadPendingInteractionBanner
          interaction={{
            ...commandInteraction(),
            origin: { kind: 'plugin', pluginId: 'ask-user', rendererId: 'form' },
            payload: { kind: 'plugin', title: 'Confirm delete', data: { path: '/tmp' } }
          }}
          threadId="thr-1"
        />
      </MemoryRouter>
    );
    expect(html).toContain('Confirm delete');
    expect(html).toContain('Plugin form is not registered.');
  });
});
