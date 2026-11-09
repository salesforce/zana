// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CompanionRequest } from '@zana-ai/zcc-domain/product';
const h = vi.hoisted(() => ({ open: vi.fn(), answer: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ product: { companion: h } }));
import { CompanionQuestion } from './CompanionQuestion.js';
let messageHeight = 80;
let resize: () => void;
const disconnect = vi.fn();
beforeEach(() => {
  messageHeight = 80;
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => messageHeight);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(40);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
function request(): CompanionRequest {
  return { id: 'thread:t1:i1', kind: 'blocked', threadId: 't1', projectId: 'p1', projectName: 'Project', agentTitle: 'Thread', prompt: 'Which path?', ts: 1, answerable: false, reason: 'thread',
    threadContext: { interactionId: 'i1', createdAt: 1, prompt: 'Which path?', lastMessage: { text: 'I tested the deployment paths.', truncated: false },
      questions: [{ id: 'q1', prompt: 'Which path?', multiSelect: false, allowFreeText: true, options: [{ value: 'staging', label: 'Staging', description: 'Test first' }] }] } };
}
it('shows the exact question and option descriptions, with expandable assistant text', () => {
  render(<CompanionQuestion request={request()} onBack={vi.fn()} onResolved={vi.fn()} />);
  expect(screen.getByText('Which path?')).toBeTruthy();
  expect(screen.getByText('Staging')).toBeTruthy();
  expect(screen.getByText('Test first')).toBeTruthy();
  const message = screen.getByText('I tested the deployment paths.');
  expect(message.className).toContain('is-clamped');
  fireEvent.click(screen.getByRole('button', { name: 'Show full message' }));
  expect(message.className).not.toContain('is-clamped');
  expect(screen.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
  expect(message.className).toContain('is-clamped');
});
it.each(['Staging (Recommended)', 'Staging — recommended', 'Staging - Recommended'])('shows the same recommendation badge as the full thread for %s', (label) => {
  const req = request();
  req.threadContext!.questions![0]!.options![0]!.label = label;
  render(<CompanionQuestion request={req} onBack={vi.fn()} onResolved={vi.fn()} />);
  expect(screen.getByText('Staging')).toBeTruthy();
  expect(screen.getByText('Test first')).toBeTruthy();
  expect(screen.getByText('Recommended').className).toBe('cc-tag');
  expect(screen.queryByText(label)).toBeNull();
  expect(screen.queryByRole('button', { name: /Staging/ })).toBeNull();
  expect(req.threadContext!.questions![0]!.options![0]).toMatchObject({ value: 'staging', label });
  expect(h.answer).not.toHaveBeenCalled();
});
it('does not infer a recommendation for an unmarked option', () => {
  render(<CompanionQuestion request={request()} onBack={vi.fn()} onResolved={vi.fn()} />);
  expect(screen.queryByText('Recommended')).toBeNull();
  expect(screen.getByText('Staging')).toBeTruthy();
});
it('only offers expansion for clipped text and rechecks when the available size changes', () => {
  messageHeight = 40;
  const { unmount } = render(<CompanionQuestion request={request()} onBack={vi.fn()} onResolved={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'Show full message' })).toBeNull();
  messageHeight = 80;
  act(() => resize());
  expect(screen.getByRole('button', { name: 'Show full message' })).toBeTruthy();
  messageHeight = 40;
  act(() => resize());
  expect(screen.queryByRole('button', { name: 'Show full message' })).toBeNull();
  unmount();
  expect(disconnect).toHaveBeenCalled();
});
it('explains a shortened server preview even when it fits without expansion', () => {
  messageHeight = 40;
  const req = request();
  req.threadContext!.lastMessage!.truncated = true;
  render(<CompanionQuestion request={req} onBack={vi.fn()} onResolved={vi.fn()} />);
  expect(screen.queryByRole('button', { name: /Show/ })).toBeNull();
  expect(screen.getByText('Message preview shortened. Open the thread for the full message.')).toBeTruthy();
});
it('opens the authoritative request, supports Back and never offers inline answers or Skip', () => {
  const back = vi.fn(), resolved = vi.fn();
  render(<CompanionQuestion request={request()} onBack={back} onResolved={resolved} />);
  for (const button of screen.getAllByRole('button', { name: 'Open in Zana' })) fireEvent.click(button);
  expect(h.open).toHaveBeenCalledTimes(2);
  expect(h.open).toHaveBeenCalledWith({ kind: 'request', requestId: 'thread:t1:i1' });
  fireEvent.keyDown(window, { key: '1' });
  fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
  expect(h.answer).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Back to the list' }));
  expect(back).toHaveBeenCalledOnce();
  expect(resolved).not.toHaveBeenCalled();
});
it('keeps every question and explains multi-select and free text without fake controls', () => {
  const req = request();
  req.threadContext!.questions!.push({ id: 'q2', prompt: 'What else?', multiSelect: true, allowFreeText: true });
  render(<CompanionQuestion request={req} onBack={vi.fn()} onResolved={vi.fn()} />);
  expect(screen.getByRole('region', { name: 'Question 1 of 2' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Question 2 of 2' })).toBeTruthy();
  expect(screen.getByText('What else?')).toBeTruthy();
  expect(screen.getByText('Choose one or more answers in the thread.')).toBeTruthy();
  expect(screen.getByText('Write your answer in the thread.')).toBeTruthy();
});
it('omits missing or duplicate context and describes truncated previews honestly', () => {
  const req = request();
  req.threadContext!.lastMessage = { text: ' Which   path? ', truncated: false };
  const { rerender } = render(<CompanionQuestion request={req} onBack={vi.fn()} onResolved={vi.fn()} />);
  expect(screen.queryByRole('region', { name: 'Last assistant message' })).toBeNull();
  req.threadContext!.lastMessage = undefined;
  rerender(<CompanionQuestion request={req} onBack={vi.fn()} onResolved={vi.fn()} />);
  expect(screen.queryByText('Last message')).toBeNull();
  req.threadContext!.lastMessage = { text: 'Long context', truncated: true };
  req.threadContext!.questions = undefined;
  rerender(<CompanionQuestion request={req} onBack={vi.fn()} onResolved={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
  expect(screen.getByText('Message preview shortened. Open the thread for the full message.')).toBeTruthy();
  expect(screen.getByText('Which path?')).toBeTruthy();
});

it('shows navigation failure without losing the pending question', async () => {
  h.open.mockRejectedValueOnce(new Error('IPC closed'));
  render(<CompanionQuestion request={request()} onBack={vi.fn()} onResolved={vi.fn()} />);
  await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Open in Zana' })[0]));
  expect(screen.getByRole('alert').textContent).toContain('Could not open Zana');
  expect(screen.getByText('Which path?')).toBeTruthy();
});
