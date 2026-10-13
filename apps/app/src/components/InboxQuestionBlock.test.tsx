// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const markAnswered = vi.fn();
const ENTRY_ID = vi.hoisted(() => 'question');
const mockState = vi.hoisted(() => ({ answered: false }));

vi.mock('../store.js', () => ({
  replyToInboxEntry: vi.fn(),
  useInboxAnswered: Object.assign(
    (pick: (state: { answeredIds: Record<string, true> }) => unknown) => pick({ answeredIds: mockState.answered ? { [ENTRY_ID]: true } : {} }),
    { getState: () => ({ markAnswered }) }
  )
}));
vi.mock('../lib/executionInboxBlockerState.js', () => ({ useExecutionInboxBlockerState: () => 'actionable' }));
vi.mock('./MarkdownContent.js', () => ({ MarkdownContent: ({ text }: { text: string }) => <span>{text}</span> }));

import { QuestionBlock } from './InboxQuestionBlock.js';

beforeEach(() => { mockState.answered = false; markAnswered.mockClear(); });
afterEach(cleanup);

describe('QuestionBlock host action metadata', () => {
  it('does not treat a normal option as a host instruction field', async () => {
    const onReply = vi.fn().mockResolvedValue(true);
    const view = render(
      <QuestionBlock
        entry={{ id: 'question', ts: 1, projectId: 'project' }}
        questions={[{ options: [{ id: 'continue', label: 'Continue normally' }] }]}
        sessionId="session"
        sessionTitle="Agent"
        onReply={onReply}
        hostActionTextOptionId="continue"
      />
    );

    fireEvent.click(screen.getByRole('radio', { name: 'A Continue normally' }));

    expect(screen.queryByLabelText('Instructions for follow-up agent')).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue', exact: true }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }));
    await waitFor(() => expect(onReply).toHaveBeenCalledWith('Continue normally'));
  });

  it('shows ordinal keys but sends the host action protocol id', async () => {
    const onHostAction = vi.fn().mockResolvedValue(true);
    const view = render(
      <QuestionBlock
        entry={{ id: 'question', ts: 1, projectId: 'project' }}
        questions={[{ options: [
          { id: 'delete', label: 'Delete' },
          { id: 'leave', label: 'Leave' }
        ] }]}
        sessionTitle="Agent"
        hostOwned
        onHostAction={onHostAction}
      />
    );

    const card = within(view.container);
    expect(card.getByRole('radio', { name: 'A Delete' })).toBeTruthy();
    expect(card.getByRole('radio', { name: 'B Leave' })).toBeTruthy();
    expect(card.queryByText('delete')).toBeNull();
    fireEvent.click(card.getByRole('radio', { name: 'A Delete' }));
    expect(card.getByRole('button', { name: 'Continue', exact: true })).toBeTruthy();
    fireEvent.click(card.getByRole('button', { name: 'Continue', exact: true }));
    await waitFor(() => expect(onHostAction).toHaveBeenCalledWith({ optionId: 'delete' }));
  });
});

describe('QuestionBlock canSend', () => {
  it('never enables Continue when there are no questions to answer', () => {
    const view = render(
      <QuestionBlock
        entry={{ id: 'empty', ts: 1, projectId: 'project' }}
        questions={[]}
        sessionId="session"
        sessionTitle="Agent"
        onReply={vi.fn()}
      />
    );
    const button = within(view.container).queryByRole('button', { name: 'Continue', exact: true });
    if (button) expect(button.hasAttribute('disabled')).toBe(true);
  });
});


describe('QuestionBlock host actions', () => {
  const entry = { id: 'question', ts: 1, projectId: 'project' };
  const options = [{ id: 'delete', label: 'Delete' }, { id: 'leave', label: 'Leave' }];
  const cont = () => screen.getByRole('button', { name: 'Continue', exact: true });

  it('stays open for a host-owned entry even when the inbox marks it answered, and hides Skip', () => {
    mockState.answered = true;
    render(
      <QuestionBlock entry={entry} questions={[{ options }]} sessionTitle="Agent" hostOwned onHostAction={vi.fn()} />
    );
    expect(screen.getByRole('radio', { name: 'A Delete' })).toBeTruthy();
    expect(screen.queryByText('Answered')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  });

  it('collapses a non-host answered entry and offers Skip on an open one', () => {
    mockState.answered = true;
    const view = render(<QuestionBlock entry={entry} questions={[{ options }]} sessionId="s" sessionTitle="Agent" onReply={vi.fn()} />);
    expect(view.container.textContent).toContain('Answered');
    cleanup();
    mockState.answered = false;
    render(<QuestionBlock entry={entry} questions={[{ options }]} sessionId="s" sessionTitle="Agent" onReply={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(markAnswered).toHaveBeenCalledWith('question');
  });

  it('requires operator text for the text option and sends it trimmed', async () => {
    const onHostAction = vi.fn().mockResolvedValue(true);
    render(
      <QuestionBlock entry={entry} questions={[{ options }]} sessionTitle="Agent" hostOwned
        onHostAction={onHostAction} hostActionTextOptionId="leave" />
    );
    fireEvent.click(screen.getByRole('radio', { name: 'A Delete' }));
    expect(screen.queryByLabelText('Instructions for follow-up agent')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'B Leave' }));
    const box = screen.getByLabelText('Instructions for follow-up agent');
    expect(cont().hasAttribute('disabled')).toBe(true);
    fireEvent.change(box, { target: { value: '   ' } });
    expect(cont().hasAttribute('disabled')).toBe(true);
    fireEvent.change(box, { target: { value: '  do it  ' } });
    expect(cont().hasAttribute('disabled')).toBe(false);
    fireEvent.click(cont());
    await waitFor(() => expect(onHostAction).toHaveBeenCalledWith({ optionId: 'leave', text: 'do it' }));
    expect(markAnswered).not.toHaveBeenCalled();
  });

  it('does not mark a non-host-owned entry answered when the host action fails, and does when it succeeds', async () => {
    const onHostAction = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<QuestionBlock entry={entry} questions={[{ options }]} sessionTitle="Agent" onHostAction={onHostAction} />);
    fireEvent.click(screen.getByRole('radio', { name: 'A Delete' }));
    fireEvent.click(cont());
    await waitFor(() => expect(onHostAction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(cont().hasAttribute('disabled')).toBe(false));
    expect(markAnswered).not.toHaveBeenCalled();
    fireEvent.click(cont());
    await waitFor(() => expect(markAnswered).toHaveBeenCalledWith('question'));
    expect(onHostAction).toHaveBeenLastCalledWith({ optionId: 'delete' });
  });

  it('shows the host status message and disables Continue when the action is unavailable', () => {
    const onHostAction = vi.fn();
    render(
      <QuestionBlock entry={entry} questions={[{ options }]} sessionTitle="Agent" hostOwned
        onHostAction={onHostAction} hostActionMessage="Worktree removed" hostActionUnavailable />
    );
    expect(screen.getByRole('alert').textContent).toBe('Worktree removed');
    fireEvent.click(screen.getByRole('radio', { name: 'A Delete' }));
    expect(cont().hasAttribute('disabled')).toBe(true);
    fireEvent.click(cont());
    expect(onHostAction).not.toHaveBeenCalled();
  });

  it('refuses to send a host action without exactly one protocol option', async () => {
    const onHostAction = vi.fn().mockResolvedValue(true);
    render(
      <QuestionBlock entry={entry} questions={[{ options, multiSelect: true }]} sessionTitle="Agent" hostOwned onHostAction={onHostAction} />
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'A Delete' }));
    expect(screen.queryByLabelText('Instructions for follow-up agent')).toBeNull();
    fireEvent.click(cont());
    await waitFor(() => expect(cont().hasAttribute('disabled')).toBe(false));
    expect(onHostAction).not.toHaveBeenCalled();
    cleanup();
    render(
      <QuestionBlock entry={entry} questions={[{ options, allowOther: true }]} sessionTitle="Agent" hostOwned onHostAction={onHostAction} />
    );
    fireEvent.focus(screen.getByLabelText('Other answer'));
    fireEvent.change(screen.getByLabelText('Other answer'), { target: { value: 'custom' } });
    fireEvent.click(cont());
    await waitFor(() => expect(cont().hasAttribute('disabled')).toBe(false));
    expect(onHostAction).not.toHaveBeenCalled();
  });
});
