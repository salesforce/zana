// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const markAnswered = vi.fn();

vi.mock('../store.js', () => ({
  replyToInboxEntry: vi.fn(),
  useInboxAnswered: Object.assign(
    (pick: (state: { answeredIds: Record<string, true> }) => unknown) => pick({ answeredIds: {} }),
    { getState: () => ({ markAnswered }) }
  )
}));
vi.mock('../lib/executionInboxBlockerState.js', () => ({ useExecutionInboxBlockerState: () => 'actionable' }));
vi.mock('./MarkdownContent.js', () => ({ MarkdownContent: ({ text }: { text: string }) => <span>{text}</span> }));

import { QuestionBlock } from './InboxQuestionBlock.js';

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
