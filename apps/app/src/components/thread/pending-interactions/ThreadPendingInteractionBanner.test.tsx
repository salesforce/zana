/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { PendingInteraction } from '@zana-ai/zcc-domain/thread-runtime';
import { product } from '../../../lib/product-client.js';
import { ThreadPendingInteractionBanner } from './ThreadPendingInteractionBanner.js';

vi.mock('../../../lib/product-client.js', () => ({
  product: {
    threads: {
      interactions: {
        resolve: vi.fn(() => Promise.resolve()),
        respond: vi.fn(() => Promise.resolve()),
        cancel: vi.fn(() => Promise.resolve())
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
    expect(html).toContain('$ git push');
    expect(html).toContain('thread-pending-banner-code');
    expect(html).toContain('Allow once');
    expect(html).toContain('Allow for session');
    expect(html).toContain('Deny');
    expect(html).toContain('thread-pending-decision-deny');
    expect(html).toContain('is-primary');
    expect(html).toContain('is-ghost');
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
    expect(html).toContain('From child agent: Child work');
    expect(html).toContain('Waiting for an answer');
    expect(html).toContain('Continue?');
    expect(html).toContain('Other…');
    expect(html).toContain('thread-pending-question-submit');
    expect(html).not.toContain('thread-pending-question-input');
  });

  it('shows one question at a time for a multi-question ask', () => {
    const question: PendingInteraction = {
      ...commandInteraction(),
      payload: {
        kind: 'user_question',
        questions: [
          {
            id: 'q1',
            prompt: 'What should the report be about?',
            shortLabel: 'Topic',
            multiSelect: false,
            allowFreeText: false,
            options: [
              { value: 'workspace', label: 'This workspace/codebase', description: 'Use the current project' },
              { value: 'else', label: 'Something else' }
            ]
          },
          {
            id: 'q2',
            prompt: 'What format do you want the report in?',
            shortLabel: 'Format',
            multiSelect: false,
            allowFreeText: true,
            options: []
          }
        ]
      }
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadPendingInteractionBanner interaction={question} threadId="thr-1" />
      </MemoryRouter>
    );
    expect(html).toContain('Waiting for answers to 2 questions');
    expect(html).toContain('1 of 2');
    expect(html).toContain('<legend>What should the report be about?</legend>');
    expect(html).not.toContain('<legend>What format do you want the report in?</legend>');
    expect(html).toContain('thread-pending-question-next');
    expect(html).not.toContain('thread-pending-question-submit');
    expect(html).toContain('This workspace/codebase');
    expect(html).toContain('Use the current project');
    expect(html).not.toContain('type="radio"');
  });

  it('shows a free-text input for an open question', () => {
    const question: PendingInteraction = {
      ...commandInteraction(),
      payload: {
        kind: 'user_question',
        questions: [{
          id: 'q1',
          prompt: 'Anything else?',
          multiSelect: false,
          allowFreeText: true
        }]
      }
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadPendingInteractionBanner interaction={question} threadId="thr-1" />
      </MemoryRouter>
    );
    expect(html).toContain('thread-pending-question-input');
    expect(html).toContain('Type your own answer');
    expect(html).toContain('thread-pending-question-submit');
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

  it('renders a long command as a code block and omits a duplicate action', () => {
    const command = 'for d in */ ; do echo "$d"; git -C "$d" status -sb; done';
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadPendingInteractionBanner
          interaction={{
            ...commandInteraction(),
            payload: {
              kind: 'approval',
              reason: command,
              availableDecisions: ['allow_once', 'deny'],
              subject: {
                kind: 'command',
                itemId: 'item-1',
                command,
                cwd: '/tmp/proj',
                actions: [{ type: 'unknown', command }],
                sessionGrant: null
              }
            }
          }}
          threadId="thr-1"
        />
      </MemoryRouter>
    );
    expect(html).toContain('thread-pending-banner-code');
    expect(html).toContain('$ for d in */ ; do echo');
    expect(html).toContain('Cwd');
    expect(html).not.toContain('>Action<');
    expect(html).not.toContain('thread-pending-banner-reason');
  });

  it('renders plan markdown with Ready to code? and plan-specific decisions', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadPendingInteractionBanner
          interaction={{
            ...commandInteraction(),
            payload: {
              kind: 'approval',
              reason: null,
              availableDecisions: ['allow_once', 'deny'],
              subject: {
                kind: 'plan',
                itemId: 'item-plan',
                plan: 'Ship it',
                planFilePath: '/tmp/plan.md'
              }
            }
          }}
          threadId="thr-1"
        />
      </MemoryRouter>
    );
    expect(html).toContain('Ready to code?');
    expect(html).toContain('data-testid="thread-pending-plan"');
    expect(html).toContain('Ship it');
    expect(html).toContain('/tmp/plan.md');
    expect(html).toContain('Approve plan');
    expect(html).toContain('Keep planning');
    expect(html).not.toContain('Allow once');
    expect(html).not.toContain('Deny');
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ThreadPendingInteractionBanner keyboard', () => {
  it('auto-focuses the primary decision and moves with arrows', () => {
    render(
      <MemoryRouter>
        <ThreadPendingInteractionBanner interaction={commandInteraction()} threadId="thr-1" />
      </MemoryRouter>
    );
    const allowOnce = screen.getByTestId('thread-pending-decision-allow_once');
    const allowSession = screen.getByTestId('thread-pending-decision-allow_for_session');
    const deny = screen.getByTestId('thread-pending-decision-deny');
    const toolbar = screen.getByTestId('thread-pending-decision-toolbar');
    expect(document.activeElement).toBe(allowOnce);
    expect(toolbar.getAttribute('role')).toBe('toolbar');

    fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(allowSession);
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(deny);
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(allowOnce);
  });

  it('resolves deny when Enter is pressed on the focused decision', () => {
    render(
      <MemoryRouter>
        <ThreadPendingInteractionBanner interaction={commandInteraction()} threadId="thr-1" />
      </MemoryRouter>
    );
    const toolbar = screen.getByTestId('thread-pending-decision-toolbar');
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByTestId('thread-pending-decision-deny'));
    fireEvent.keyDown(toolbar, { key: 'Enter' });
    expect(product.threads.interactions.resolve).toHaveBeenCalledWith(
      'thr-1',
      'pint_1',
      { decision: 'deny' }
    );
  });

  it('does not auto-focus the question submit button', () => {
    render(
      <MemoryRouter>
        <ThreadPendingInteractionBanner
          interaction={{
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
          }}
          threadId="thr-1"
        />
      </MemoryRouter>
    );
    expect(document.activeElement).not.toBe(screen.getByTestId('thread-pending-question-submit'));
    expect(screen.queryByTestId('thread-pending-decision-toolbar')).toBeNull();
  });
});
