/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PendingInteractionUserQuestionQuestion } from '@zana-ai/zcc-domain/thread-runtime';
import { QuestionInteractionBanner } from './QuestionInteractionBanner.js';

afterEach(cleanup);
let sequence = 0;
const questions: PendingInteractionUserQuestionQuestion[] = [
  { id: 'target', prompt: 'Choose a target', shortLabel: 'Target', multiSelect: false, allowFreeText: true,
    options: [{ value: 'desktop', label: 'Desktop' }, { value: 'browser', label: 'Browser' }] },
  { id: 'pattern', prompt: 'Choose an answer pattern', shortLabel: 'Pattern', multiSelect: false, allowFreeText: true,
    options: [{ value: 'every', label: 'Other on every question' }, { value: 'dns', label: 'Custom DNS' }] },
  { id: 'version', prompt: 'Which version?', shortLabel: 'Version', multiSelect: false, allowFreeText: true,
    options: [{ value: 'latest', label: 'Latest' }] }
];
function mount(items = questions, overrides: Partial<ComponentProps<typeof QuestionInteractionBanner>> = {}) {
  const onSubmit = vi.fn(async () => {});
  const props = { interactionId: `question-regression-${++sequence}`, threadId: 'question-regressions', questions: items, onSubmit, ...overrides };
  return { ...render(<QuestionInteractionBanner {...props} />), onSubmit, props };
}
const primary = () => screen.getByTestId('thread-pending-question-submit') as HTMLButtonElement;
const step = (index: number) => fireEvent.click(screen.getAllByTestId('thread-pending-question-step')[index]);

describe('question selection and submission regressions', () => {
  it('keeps Other-prefixed choices ordinary and retains a separate Other choice', async () => {
    const { onSubmit } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Desktop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Other on every question' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Other…' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Other…' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  2.0  ' } });
    fireEvent.click(primary());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      target: { selected: ['desktop'] }, pattern: { selected: ['every'] }, version: { selected: [], freeText: '2.0' }
    }));
  });

  it.each(['click', 'shortcut'])('focuses Other after %s selection so digit keys stay in the textarea', (method) => {
    mount([questions[0]]);
    const other = screen.getByRole('button', { name: 'Other…' });
    if (method === 'click') fireEvent.click(other);
    else fireEvent.keyDown(primary().closest('form')!, { key: '3' });
    const input = screen.getByRole('textbox');
    expect(document.activeElement).toBe(input);
    expect(fireEvent.keyDown(input, { key: '2' })).toBe(true);
    expect(screen.getByRole('button', { name: 'Other…' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Browser' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('focuses explicit legacy Other choices, but does not steal focus on unrelated rerenders', () => {
    const legacy = { ...questions[0], options: [{ value: 'custom', label: 'Something else' }] };
    const view = mount([legacy]);
    fireEvent.click(screen.getByRole('button', { name: 'Something else' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    primary().focus();
    view.rerender(<QuestionInteractionBanner {...view.props} questions={[{ ...legacy }]} />);
    expect(document.activeElement).toBe(primary());
  });

  it('allows multi-select Other to be deselected without refocusing the hidden textarea', () => {
    mount([{ ...questions[0], multiSelect: true }]);
    fireEvent.click(screen.getByRole('button', { name: 'Other…' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    const other = screen.getByRole('button', { name: 'Other…' });
    other.focus();
    fireEvent.click(other);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(other);
  });

  it('keeps focus on ordinary multi-select choices when Other is also selected', () => {
    mount([{ ...questions[0], multiSelect: true }]);
    fireEvent.click(screen.getByRole('button', { name: 'Other…' }));
    const desktop = screen.getByRole('button', { name: 'Desktop' });
    desktop.focus();
    fireEvent.click(desktop);
    expect(document.activeElement).toBe(desktop);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it.each(['click', 'chord', 'form'])('reviews missing earlier answers on %s instead of silently blocking', async (method) => {
    const { onSubmit } = mount();
    step(2);
    fireEvent.click(screen.getByRole('button', { name: 'Other…' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '2.0' } });
    expect(primary().disabled).toBe(false);
    expect(screen.getByRole('status').textContent).toBe('Answer before submitting: Target, Pattern.');
    expect(primary().getAttribute('aria-describedby')).toBe(screen.getByRole('status').id);
    if (method === 'click') fireEvent.click(primary());
    else if (method === 'chord') fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true });
    else fireEvent.submit(primary().closest('form')!);
    expect(screen.getByText('1 of 3')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Desktop' }));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Desktop' }));
    expect(screen.getByRole('status').textContent).toBe('Answer before submitting: Pattern.');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Custom DNS' }));
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(primary());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('focuses an empty custom answer even when reviewing the current question', () => {
    mount([{ ...questions[0], shortLabel: undefined }]);
    fireEvent.click(screen.getByRole('button', { name: 'Other…' }));
    primary().focus();
    fireEvent.click(primary());
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    expect(screen.getByRole('status').textContent).toBe('Answer before submitting: Question 1.');
  });

  it('keeps the primary button type stable when Next becomes Submit', async () => {
    const { onSubmit } = mount();
    for (let index = 0; index < 3; index++) {
      step(index);
      fireEvent.click(screen.getByRole('button', { name: ['Desktop', 'Custom DNS', 'Latest'][index] }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    const next = screen.getByRole('button', { name: 'Next' });
    expect(next.getAttribute('type')).toBe('button');
    fireEvent.click(next);
    expect(primary()).toBe(next);
    expect(primary().getAttribute('type')).toBe('button');
    await act(async () => {});
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(primary());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('does not review or submit while resolving and disables empty forms', () => {
    const { onSubmit, rerender, props } = mount([questions[0]], { resolving: true });
    fireEvent.submit(primary().closest('form')!);
    fireEvent.click(primary());
    expect(primary().disabled).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    rerender(<QuestionInteractionBanner {...props} resolving={false} questions={[]} />);
    expect(primary().disabled).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
