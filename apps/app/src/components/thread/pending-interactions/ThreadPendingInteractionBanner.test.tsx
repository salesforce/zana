/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { ApprovalPendingInteraction, PendingInteraction } from '@zana-ai/zcc-domain/thread-runtime';
import { product } from '../../../lib/product-client.js';
import { ThreadPendingInteractionBanner } from './ThreadPendingInteractionBanner.js';
import { loadQuestionDraft, questionDraftKey } from './question-drafts.js';

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

function commandInteraction(): ApprovalPendingInteraction {
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

  it('wraps native prompts in a collapsible pending-interaction shell', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadPendingInteractionBanner interaction={commandInteraction()} threadId="thr-1" />
      </MemoryRouter>
    );
    expect(html).toContain('thread-pending-shell');
    expect(html).toContain('thread-pending-attention-dot');
    expect(html).toContain('data-testid="thread-pending-shell-toggle"');
    expect(html).toContain('Collapse');
  });

  it('collapses the pending-interaction body', () => {
    render(
      <MemoryRouter>
        <ThreadPendingInteractionBanner interaction={commandInteraction()} threadId="thr-1" />
      </MemoryRouter>
    );
    expect(screen.getByText('$ git push')).toBeTruthy();
    fireEvent.click(screen.getByTestId('thread-pending-shell-toggle'));
    expect(screen.queryByText('$ git push')).toBeNull();
    expect(screen.getByText('Expand')).toBeTruthy();
  });

  it('keeps command context in a closed disclosure and session grants visible', () => {
    const interaction = commandInteraction();
    if (interaction.payload.subject.kind !== 'command') throw new Error('Expected command');
    interaction.payload.subject.command = "/bin/zsh -lc 'git push'";
    interaction.payload.subject.actions = [{ type: 'unknown', command: 'git push' }];
    interaction.payload.subject.sessionGrant = { network: { enabled: true }, fileSystem: null };
    const { container } = render(
      <MemoryRouter>
        <ThreadPendingInteractionBanner interaction={interaction} threadId="thr-1" />
      </MemoryRouter>
    );
    const disclosure = container.querySelector('details')!;
    expect(disclosure.open).toBe(false);
    expect(disclosure.querySelector('summary')?.textContent).toBe('Details');
    expect(disclosure.textContent).toContain('/tmp/proj');
    expect(disclosure.textContent).toContain('git push');
    expect(screen.getByLabelText('Command').closest('details')).toBeNull();
    expect(screen.getByText('Needs approval').closest('details')).toBeNull();
    expect(screen.getByText('Network access').closest('details')).toBeNull();
    expect(screen.getByRole('toolbar', { name: 'Approval decisions' }).closest('details')).toBeNull();
  });

  it('omits the disclosure when there are no additional command details', () => {
    const interaction = commandInteraction();
    if (interaction.payload.subject.kind !== 'command') throw new Error('Expected command');
    interaction.payload.subject.cwd = null;
    const { container } = render(
      <MemoryRouter>
        <ThreadPendingInteractionBanner interaction={interaction} threadId="thr-1" />
      </MemoryRouter>
    );
    expect(container.querySelector('details')).toBeNull();
    expect(screen.getByLabelText('Command').textContent).toBe('$ git push');
  });

  it('resets expanded command details for a new approval', () => {
    const interaction = commandInteraction();
    const { container, rerender } = render(
      <MemoryRouter>
        <ThreadPendingInteractionBanner interaction={interaction} threadId="thr-1" />
      </MemoryRouter>
    );
    container.querySelector('details')!.open = true;
    rerender(
      <MemoryRouter>
        <ThreadPendingInteractionBanner interaction={{ ...interaction, id: 'pint_2' }} threadId="thr-1" />
      </MemoryRouter>
    );
    expect(container.querySelector('details')!.open).toBe(false);
  });

  it.each([true, false])('leaves permission approvals expanded (has permissions: %s)', (hasPermissions) => {
    const interaction: ApprovalPendingInteraction = {
      ...commandInteraction(),
      payload: {
        kind: 'approval', reason: null, availableDecisions: ['allow_once', 'deny'],
        subject: {
          kind: 'permission_grant', itemId: 'permission-1', toolName: null,
          permissions: { network: hasPermissions ? { enabled: true } : null, fileSystem: null }
        }
      }
    };
    const { container } = render(
      <MemoryRouter>
        <ThreadPendingInteractionBanner interaction={interaction} threadId="thr-1" />
      </MemoryRouter>
    );
    expect(container.querySelector('.thread-pending-command')).toBeNull();
    expect(container.querySelector('details')).toBeNull();
    expect(Boolean(screen.queryByText('Network access'))).toBe(hasPermissions);
    expect(Boolean(container.querySelector('.thread-pending-banner-details'))).toBe(hasPermissions);
  });

  it('renders a source-thread link and a question form', () => {
    const question = {
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
      },
      resolution: null
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadPendingInteractionBanner
          interaction={question as any}
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
    const question = {
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
      },
      resolution: null
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadPendingInteractionBanner interaction={question as any} threadId="thr-1" />
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
    const question = {
      ...commandInteraction(),
      payload: {
        kind: 'user_question',
        questions: [{
          id: 'q1',
          prompt: 'Anything else?',
          multiSelect: false,
          allowFreeText: true
        }]
      },
      resolution: null
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadPendingInteractionBanner interaction={question as any} threadId="thr-1" />
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
          interaction={{...({} as any),
            ...commandInteraction(),
            turnId: null,
            origin: { kind: 'plugin', pluginId: 'ask-user', rendererId: 'form' },
            payload: { kind: 'plugin', title: 'Confirm delete', data: { path: '/tmp' } },
            resolution: null
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
          interaction={{...({} as any),
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
          interaction={{...({} as any),
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
            },
            // Payload and resolution are paired per union member (WS5 split): a
            // user_question interaction must carry a user-answer/null resolution,
            // not the approval resolution the spread base provides.
            resolution: null
          }}
          threadId="thr-1"
        />
      </MemoryRouter>
    );
    expect(document.activeElement).not.toBe(screen.getByTestId('thread-pending-question-submit'));
    expect(screen.queryByTestId('thread-pending-decision-toolbar')).toBeNull();
  });
});

describe('polished question card', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(product.threads.interactions.resolve).mockClear();
  });

  function worktreeQuestion(id: string, overrides: Record<string, unknown> = {}): PendingInteraction {
    return {
      ...commandInteraction(), id, resolution: null,
      payload: { kind: 'user_question', questions: [{
        id: 'approach',
        prompt: 'Another session is on `main`. How should I proceed?',
        shortLabel: 'Approach',
        multiSelect: false,
        allowFreeText: true,
        options: [
          { value: 'tree', label: 'Use a worktree (Recommended)', description: 'Create `.worktrees/fix` from origin/main' },
          { value: 'here', label: 'Work in this checkout' },
          { value: 'wait', label: 'Wait' }
        ],
        ...overrides
      }] }
    } as PendingInteraction;
  }
  const viewOf = (interaction: PendingInteraction) => <MemoryRouter>
    <ThreadPendingInteractionBanner interaction={interaction} threadId="polish-thread" />
  </MemoryRouter>;

  it('renders the short label chip, inline code, a Recommended badge and preselects it', () => {
    const { container } = render(viewOf(worktreeQuestion('polish-render')));
    expect(screen.getByTestId('thread-pending-question-chip').textContent).toBe('Approach');
    expect(container.querySelector('legend code')?.textContent).toBe('main');
    expect(container.querySelector('.thread-pending-option-desc code')?.textContent).toBe('.worktrees/fix');
    const recommended = screen.getByTestId('thread-pending-option-recommended').closest('button')!;
    expect(recommended.getAttribute('aria-pressed')).toBe('true');
    expect(recommended.textContent).not.toContain('(Recommended)');
    expect(screen.getByTestId('thread-pending-question-submit').hasAttribute('disabled')).toBe(false);
    expect(container.querySelectorAll('.thread-pending-option-key')).toHaveLength(4);
    expect(container.querySelector('.thread-pending-question-hint')?.textContent).toContain('to submit');
  });

  it('selects choices with digit keys and submits with Enter from an option', async () => {
    const interaction = worktreeQuestion('polish-keys');
    render(viewOf(interaction));
    const form = screen.getByTestId('thread-pending-question-submit').closest('form')!;
    fireEvent.keyDown(form, { key: '3' });
    expect(screen.getByRole('button', { name: 'Wait' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(form, { key: '9' });
    fireEvent.keyDown(form, { key: '2', metaKey: true });
    expect(screen.getByRole('button', { name: 'Wait' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(form, { key: 'Enter' });
    expect(product.threads.interactions.resolve).not.toHaveBeenCalled();
    fireEvent.keyDown(form, { key: '4' });
    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: '1' });
    expect(screen.getByRole('button', { name: 'Other…' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(form, { key: '3' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Wait' }), { key: 'Enter' });
    await waitFor(() => expect(product.threads.interactions.resolve).toHaveBeenCalledWith('polish-thread', interaction.id, {
      kind: 'user_answer', answers: { approach: { selected: ['wait'] } }
    }));
  });

  it('advances with Enter on a multi-question ask and skips the chip', () => {
    const interaction = worktreeQuestion('polish-steps');
    if (interaction.payload.kind !== 'user_question') throw new Error('Expected question');
    interaction.payload.questions.push({ id: 'second', prompt: 'Anything else?', multiSelect: false, allowFreeText: true });
    render(viewOf(interaction));
    expect(screen.queryByTestId('thread-pending-question-chip')).toBeNull();
    expect(screen.getByText(/to continue/)).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('button', { name: /Use a worktree/ }), { key: 'Enter' });
    expect(screen.getByText('2 of 2')).toBeTruthy();
  });
});

describe('question drafts across navigation', () => {
  function question(id: string): PendingInteraction {
    return {
      ...commandInteraction(), id, resolution: null,
      payload: { kind: 'user_question', questions: [
        { id: 'topic', prompt: 'Choose a topic', multiSelect: false, allowFreeText: true,
          options: [{ value: 'code', label: 'Code' }, { value: 'docs', label: 'Docs' }] },
        { id: 'details', prompt: 'Describe the changes', multiSelect: false, allowFreeText: true }
      ] }
    };
  }
  const viewOf = (interaction: PendingInteraction, threadId = 'draft-thread') => <MemoryRouter>
    <ThreadPendingInteractionBanner interaction={interaction} threadId={threadId} />
  </MemoryRouter>;

  it('restores the selected question, option and free text after leaving and returning', () => {
    const interaction = question('draft-navigation');
    const first = render(viewOf(interaction));
    fireEvent.click(screen.getByRole('button', { name: 'Docs' }));
    fireEvent.click(screen.getByTestId('thread-pending-question-next'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep both phone and desktop' } });
    first.unmount();
    render(viewOf(interaction));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Keep both phone and desktop');
    expect(screen.getByText('2 of 2')).toBeTruthy();
    fireEvent.click(screen.getByTestId('thread-pending-question-back'));
    expect(screen.getByRole('button', { name: 'Docs' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getAllByTestId('thread-pending-question-step')[1]);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Keep both phone and desktop');
  });

  it('resets a draft when the interaction or question schema changes, and isolates threads', () => {
    const interaction = question('draft-identity');
    const view = render(viewOf(interaction));
    fireEvent.click(screen.getByTestId('thread-pending-question-next'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Private answer' } });
    view.rerender(viewOf(interaction, 'other-thread'));
    expect(screen.getByText('1 of 2')).toBeTruthy();
    view.rerender(viewOf(question('different-interaction')));
    expect(screen.getByText('1 of 2')).toBeTruthy();
    const changed = question('draft-identity');
    if (changed.payload.kind !== 'user_question') throw new Error('Expected question');
    changed.payload.questions[0].prompt = 'A revised question';
    view.rerender(viewOf(changed));
    expect(screen.getByText('A revised question')).toBeTruthy();
    fireEvent.click(screen.getByTestId('thread-pending-question-next'));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });

  it('keeps answers after a failed submission and clears only the successfully submitted draft', async () => {
    const interaction = question('draft-submit');
    vi.mocked(product.threads.interactions.resolve).mockRejectedValueOnce(new Error('Disconnected'));
    render(viewOf(interaction));
    fireEvent.click(screen.getByRole('button', { name: 'Other…' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Another topic' } });
    fireEvent.click(screen.getByTestId('thread-pending-question-next'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Draft details' } });
    fireEvent.click(screen.getByTestId('thread-pending-question-submit'));
    await screen.findByText('Disconnected');
    await waitFor(() => expect(screen.getByTestId('thread-pending-question-submit').hasAttribute('disabled')).toBe(false));
    if (interaction.payload.kind !== 'user_question') throw new Error('Expected question');
    const key = questionDraftKey('draft-thread', interaction.id);
    expect(loadQuestionDraft(key, interaction.payload.questions).answers.details.freeText).toBe('Draft details');
    fireEvent.click(screen.getByTestId('thread-pending-question-submit'));
    const questions = interaction.payload.questions;
    await waitFor(() => expect(loadQuestionDraft(key, questions).answers.details.freeText).toBe(''));
    expect(product.threads.interactions.resolve).toHaveBeenLastCalledWith('draft-thread', interaction.id, {
      kind: 'user_answer', answers: {
        topic: { selected: [], freeText: 'Another topic' },
        details: { selected: [], freeText: 'Draft details' }
      }
    });
  });
});
