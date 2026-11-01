/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  it.each(['input', 'textarea', 'div', 'button'])('keeps focus in a %s when a new approval arrives', (tag) => {
    const active = document.createElement(tag);
    if (tag === 'div') active.contentEditable = 'true';
    active.tabIndex = 0;
    document.body.append(active);
    active.focus();
    const view = render(<MemoryRouter>
      <ThreadPendingInteractionBanner interaction={commandInteraction()} threadId="thr-1" />
    </MemoryRouter>);
    expect(document.activeElement).toBe(active);
    view.rerender(<MemoryRouter>
      <ThreadPendingInteractionBanner interaction={{ ...commandInteraction(), id: 'another-agent-approval' }} threadId="thr-1" />
    </MemoryRouter>);
    expect(document.activeElement).toBe(active);
    active.remove();
  });

  it('keeps the focused decision when another agent requests approval', () => {
    const view = render(<MemoryRouter>
      <ThreadPendingInteractionBanner interaction={commandInteraction()} threadId="thr-1" />
    </MemoryRouter>);
    const first = document.activeElement;
    view.rerender(<MemoryRouter>
      <ThreadPendingInteractionBanner interaction={commandInteraction()} threadId="thr-1" />
      <ThreadPendingInteractionBanner interaction={{ ...commandInteraction(), id: 'second' }} threadId="thr-2" />
    </MemoryRouter>);
    expect(document.activeElement).toBe(first);
  });

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

describe('Ctrl+Enter / ⌘↵ does what the primary button does', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.mocked(product.threads.interactions.resolve).mockClear();
  });

  function twoQuestions(id: string, second: Record<string, unknown> = {}): PendingInteraction {
    return {
      ...commandInteraction(), id, resolution: null,
      payload: { kind: 'user_question', questions: [
        { id: 'topic', prompt: 'Choose a topic', multiSelect: false, allowFreeText: true,
          options: [{ value: 'code', label: 'Code' }, { value: 'docs', label: 'Docs' }] },
        { id: 'details', prompt: 'Describe the changes', multiSelect: false, allowFreeText: true, ...second }
      ] }
    };
  }
  const viewOf = (interaction: PendingInteraction, threadId = 'chord-thread') => <MemoryRouter>
    <ThreadPendingInteractionBanner interaction={interaction} threadId={threadId} />
  </MemoryRouter>;
  const ctrlEnter = (target: Element, init: Record<string, boolean> = {}) => (
    fireEvent.keyDown(target, { key: 'Enter', ctrlKey: true, ...init })
  );

  it('goes Next from the free-text box, keeps plain Enter as a newline, and submits with ⌘↵ on the last question', async () => {
    const interaction = twoQuestions('chord-textarea');
    render(viewOf(interaction));
    fireEvent.click(screen.getByRole('button', { name: 'Other…' }));
    const first = screen.getByRole('textbox');
    fireEvent.change(first, { target: { value: 'Another topic' } });
    expect(fireEvent.keyDown(first, { key: 'Enter' })).toBe(true);
    expect(screen.getByText('1 of 2')).toBeTruthy();
    first.focus();
    expect(ctrlEnter(first)).toBe(false);
    expect(screen.getByText('2 of 2')).toBeTruthy();
    const second = screen.getByRole('textbox');
    expect(document.activeElement).toBe(second);
    fireEvent.change(second, { target: { value: 'Line one' } });
    expect(fireEvent.keyDown(second, { key: 'Enter' })).toBe(true);
    expect(product.threads.interactions.resolve).not.toHaveBeenCalled();
    fireEvent.keyDown(second, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(product.threads.interactions.resolve).toHaveBeenCalledWith('chord-thread', interaction.id, {
      kind: 'user_answer', answers: {
        topic: { selected: [], freeText: 'Another topic' },
        details: { selected: [], freeText: 'Line one' }
      }
    }));
  });

  it('acts from any control in the panel and blocks the focused button’s own Enter', () => {
    render(viewOf(twoQuestions('chord-buttons')));
    const docs = screen.getByRole('button', { name: 'Docs' });
    fireEvent.click(docs);
    expect(ctrlEnter(screen.getAllByTestId('thread-pending-question-step')[0])).toBe(false);
    expect(screen.getByText('2 of 2')).toBeTruthy();
    // Last question unanswered: Ctrl+Enter on Back neither goes back nor submits.
    expect(ctrlEnter(screen.getByTestId('thread-pending-question-back'))).toBe(false);
    expect(screen.getByText('2 of 2')).toBeTruthy();
    expect(product.threads.interactions.resolve).not.toHaveBeenCalled();
  });

  it('jumps back to the first unanswered question when the last one is answered, then submits', async () => {
    const interaction = twoQuestions('chord-unanswered');
    render(viewOf(interaction));
    fireEvent.click(screen.getAllByTestId('thread-pending-question-step')[1]);
    const details = screen.getByRole('textbox');
    fireEvent.change(details, { target: { value: 'Details first' } });
    details.focus();
    ctrlEnter(details);
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Code' }));
    fireEvent.keyDown(document.activeElement!, { key: '2' });
    ctrlEnter(document.activeElement!);
    expect(screen.getByText('2 of 2')).toBeTruthy();
    ctrlEnter(document.activeElement!);
    await waitFor(() => expect(product.threads.interactions.resolve).toHaveBeenCalledWith('chord-thread', interaction.id, {
      kind: 'user_answer', answers: {
        topic: { selected: ['docs'] },
        details: { selected: [], freeText: 'Details first' }
      }
    }));
  });

  it('keeps focus in the panel after Enter on an option unmounts it, preferring the selected option', () => {
    render(viewOf(twoQuestions('chord-refocus', {
      allowFreeText: false,
      options: [{ value: 'small', label: 'Small' }, { value: 'large', label: 'Large (Recommended)' }]
    })));
    const code = screen.getByRole('button', { name: 'Code' });
    code.focus();
    fireEvent.keyDown(code, { key: 'Enter' });
    expect(screen.getByText('2 of 2')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Large/ }));
  });

  it('keeps focus in the panel when Back unmounts itself and when Next turns into Submit', () => {
    render(viewOf(twoQuestions('chord-buttons-focus')));
    fireEvent.click(screen.getByRole('button', { name: 'Docs' }));
    const next = screen.getByTestId('thread-pending-question-next');
    next.focus();
    fireEvent.click(next);
    expect(screen.getByText('2 of 2')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId('thread-pending-question-submit'));
    const back = screen.getByTestId('thread-pending-question-back');
    back.focus();
    fireEvent.click(back);
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(screen.queryByTestId('thread-pending-question-back')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Docs' }));
  });

  it('ignores Shift or Alt chords and does nothing while the answer is being sent', () => {
    const interaction = twoQuestions('chord-ignored');
    const view = render(viewOf(interaction));
    const code = screen.getByRole('button', { name: 'Code' });
    ctrlEnter(code, { shiftKey: true });
    ctrlEnter(code, { altKey: true });
    expect(screen.getByText('1 of 2')).toBeTruthy();
    view.rerender(viewOf({ ...interaction, status: 'resolving' } as PendingInteraction));
    expect(ctrlEnter(screen.getByRole('button', { name: 'Code' }))).toBe(false);
    expect(screen.getByText('1 of 2')).toBeTruthy();
  });

  it('only moves the panel that has focus', () => {
    render(<>{viewOf(twoQuestions('chord-panel-a'), 'thread-a')}{viewOf(twoQuestions('chord-panel-b'), 'thread-b')}</>);
    const [a] = screen.getAllByRole('button', { name: 'Code' });
    ctrlEnter(a);
    expect(screen.getByText('2 of 2')).toBeTruthy();
    expect(screen.getByText('1 of 2')).toBeTruthy();
  });

  it('shows the shortcut on the Next and Submit buttons for the platform', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    const view = render(viewOf(twoQuestions('chord-title-win')));
    const next = screen.getByTestId('thread-pending-question-next');
    expect(next.title).toBe('Next (Ctrl+Enter)');
    expect(next.getAttribute('aria-keyshortcuts')).toBe('Control+Enter Meta+Enter');
    fireEvent.click(next);
    expect(screen.getByTestId('thread-pending-question-submit').title).toBe('Submit (Ctrl+Enter)');
    view.unmount();
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    render(viewOf(twoQuestions('chord-title-mac')));
    expect(screen.getByTestId('thread-pending-question-next').title).toBe('Next (⌘↵)');
  });
});

describe('resolved cards stay locked until they unmount', () => {
  const decisionIds = ['allow_once', 'allow_for_session', 'deny'];
  const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const approvalView = () => <MemoryRouter>
    <ThreadPendingInteractionBanner interaction={commandInteraction()} threadId="thr-1" />
  </MemoryRouter>;
  function recommendedQuestion(id: string): PendingInteraction {
    return {
      ...commandInteraction(), id, resolution: null,
      payload: { kind: 'user_question', questions: [{
        id: 'approach', prompt: 'How should I proceed?', multiSelect: false, allowFreeText: true,
        options: [{ value: 'tree', label: 'Use a worktree (Recommended)' }, { value: 'here', label: 'Work here' }]
      }] }
    } as PendingInteraction;
  }
  const questionView = (interaction: PendingInteraction) => <MemoryRouter>
    <ThreadPendingInteractionBanner interaction={interaction} threadId="lock-thread" />
  </MemoryRouter>;

  it('keeps every approval decision disabled after a successful resolve so it cannot be double-submitted', async () => {
    render(approvalView());
    fireEvent.click(screen.getByTestId('thread-pending-decision-allow_once'));
    await settle();
    for (const id of decisionIds) {
      expect((screen.getByTestId(`thread-pending-decision-${id}`) as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.click(screen.getByTestId('thread-pending-decision-deny'));
    fireEvent.keyDown(screen.getByTestId('thread-pending-decision-toolbar'), { key: 'Enter' });
    expect(product.threads.interactions.resolve).toHaveBeenCalledTimes(1);
  });

  it('re-enables the approval decisions and shows the error when resolving fails, then allows a retry', async () => {
    vi.mocked(product.threads.interactions.resolve).mockRejectedValueOnce(new Error('Disconnected'));
    render(approvalView());
    fireEvent.click(screen.getByTestId('thread-pending-decision-deny'));
    expect((screen.getByTestId('thread-pending-decision-deny') as HTMLButtonElement).disabled).toBe(true);
    await screen.findByText('Disconnected');
    for (const id of decisionIds) {
      expect((screen.getByTestId(`thread-pending-decision-${id}`) as HTMLButtonElement).disabled).toBe(false);
    }
    fireEvent.click(screen.getByTestId('thread-pending-decision-deny'));
    await settle();
    expect(product.threads.interactions.resolve).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Disconnected')).toBeNull();
  });

  it('falls back to a generic message when the approval failure is not an Error', async () => {
    vi.mocked(product.threads.interactions.resolve).mockRejectedValueOnce('boom');
    render(approvalView());
    fireEvent.click(screen.getByTestId('thread-pending-decision-allow_once'));
    await screen.findByText('Failed to resolve pending interaction');
  });

  it('gives a new interaction a fresh, enabled approval card after the previous one resolved', async () => {
    const view = render(approvalView());
    fireEvent.click(screen.getByTestId('thread-pending-decision-allow_once'));
    await settle();
    view.rerender(<MemoryRouter>
      <ThreadPendingInteractionBanner key="pint_2" interaction={{ ...commandInteraction(), id: 'pint_2' }} threadId="thr-1" />
    </MemoryRouter>);
    expect((screen.getByTestId('thread-pending-decision-allow_once') as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps a successfully answered question on screen and locked instead of flashing it back to editable', async () => {
    render(questionView(recommendedQuestion('lock-success')));
    fireEvent.click(screen.getByRole('button', { name: 'Other…' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Something else' } });
    fireEvent.click(screen.getByTestId('thread-pending-question-submit'));
    await settle();
    expect((screen.getByTestId('thread-pending-question-submit') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Work here' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Something else');
    fireEvent.submit(screen.getByTestId('thread-pending-question-submit').closest('form')!);
    expect(product.threads.interactions.resolve).toHaveBeenCalledTimes(1);
  });

  it('unlocks a question whose submission failed, keeping the typed answer', async () => {
    vi.mocked(product.threads.interactions.resolve).mockRejectedValueOnce(new Error('Offline'));
    render(questionView(recommendedQuestion('lock-failure')));
    fireEvent.click(screen.getByRole('button', { name: 'Other…' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Retry me' } });
    fireEvent.click(screen.getByTestId('thread-pending-question-submit'));
    await screen.findByText('Offline');
    expect((screen.getByTestId('thread-pending-question-submit') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Retry me');
  });

  it('falls back to a generic message when the question failure is not an Error', async () => {
    vi.mocked(product.threads.interactions.resolve).mockRejectedValueOnce(undefined);
    render(questionView(recommendedQuestion('lock-generic')));
    fireEvent.click(screen.getByTestId('thread-pending-question-submit'));
    await screen.findByText('Failed to answer question');
  });
});

describe('question panel key hint follows focus', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function choiceQuestion(id: string, extra = false): PendingInteraction {
    const questions = [{ id: 'pick', prompt: 'Pick one', multiSelect: false, allowFreeText: true,
      options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }] }];
    if (extra) questions.push({ id: 'more', prompt: 'Anything else?', multiSelect: false, allowFreeText: true, options: [] });
    return { ...commandInteraction(), id, resolution: null, payload: { kind: 'user_question', questions } } as PendingInteraction;
  }
  const hintKeys = () => [...screen.getByTestId('thread-pending-question-hint').querySelectorAll('kbd')].map((kbd) => kbd.textContent);
  const hintText = () => screen.getByTestId('thread-pending-question-hint').textContent;

  it('shows Ctrl+↵ off macOS until an option has focus, then plain ↵; drops digits in the free-text box', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    render(<MemoryRouter><ThreadPendingInteractionBanner interaction={choiceQuestion('hint-focus')} threadId="hint-thread" /></MemoryRouter>);
    expect(hintKeys()).toEqual(['1', '3', 'Ctrl', '↵']);
    expect(hintText()).toContain('to submit');
    fireEvent.focus(screen.getByRole('button', { name: 'Alpha' }));
    expect(hintKeys()).toEqual(['1', '3', '↵']);
    fireEvent.blur(screen.getByRole('button', { name: 'Alpha' }));
    expect(hintKeys()).toEqual(['1', '3', 'Ctrl', '↵']);
    fireEvent.click(screen.getByRole('button', { name: 'Other…' }));
    fireEvent.focus(screen.getByRole('textbox'));
    expect(hintKeys()).toEqual(['Ctrl', '↵']);
    expect(hintText()).not.toContain('to choose');
    fireEvent.focus(screen.getByTestId('thread-pending-question-submit'));
    expect(hintKeys()).toEqual(['1', '3', 'Ctrl', '↵']);
  });

  it('uses ⌘↵ on macOS and says continue before the last question', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    render(<MemoryRouter><ThreadPendingInteractionBanner interaction={choiceQuestion('hint-mac', true)} threadId="hint-thread" /></MemoryRouter>);
    expect(hintKeys()).toEqual(['1', '3', '⌘', '↵']);
    expect(hintText()).toContain('to continue');
  });
});
