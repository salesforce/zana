// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CompanionRequest } from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({ answer: vi.fn(), open: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ product: { companion: { answer: h.answer, open: h.open } } }));
import { CompanionQuestion } from './CompanionQuestion.js';

beforeEach(() => {
  h.answer.mockReset().mockResolvedValue({ ok: true });
  h.open.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function request(over: Partial<CompanionRequest> = {}): CompanionRequest {
  return {
    id: 'inbox:e1',
    kind: 'question',
    entryId: 'e1',
    sessionId: 's1',
    projectId: 'p1',
    projectName: 'Proj',
    agentTitle: 'Builder',
    prompt: 'Which way?',
    questions: [{ options: [{ id: 'A', label: 'Left (Recommended)' }, { id: 'B', label: 'Right' }], allowOther: true }],
    ts: 0,
    answerable: true,
    ...over
  } as CompanionRequest;
}

function renderQ(req = request()) {
  const onBack = vi.fn();
  const onResolved = vi.fn();
  render(<CompanionQuestion request={req} onBack={onBack} onResolved={onResolved} />);
  return { onBack, onResolved, send: () => screen.getByRole('button', { name: 'Send' }) };
}

it('sends the picked option, shows Sent, then resolves the request', async () => {
  vi.useFakeTimers();
  const { onResolved, send } = renderQ();
  expect(screen.getByText('Recommended')).toBeTruthy();
  expect((send() as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /Right/ }));
  expect(screen.getByRole('button', { name: /Right/ }).getAttribute('aria-pressed')).toBe('true');
  await act(async () => {
    fireEvent.click(send());
  });
  expect(h.answer).toHaveBeenCalledWith('inbox:e1', 'Right');
  expect(screen.getByRole('status').textContent).toContain('Builder is continuing');
  act(() => vi.advanceTimersByTime(1000));
  expect(onResolved).toHaveBeenCalledOnce();
});

it('shows a failure as an error with an Open thread action', () => {
  renderQ(request({ kind: 'blocked', reason: 'thread-error', answerable: false, questions: undefined, prompt: 'Thread failed: Connection closed.' }));
  expect(screen.getByText('Thread failed: Connection closed.')).toBeTruthy();
  expect(screen.getByText('This thread stopped with an error. Open the thread to review it.')).toBeTruthy();
  expect(screen.queryByText(/Waiting in a thread/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: 'Open thread' })[1]);
  expect(h.open).toHaveBeenCalledWith({ kind: 'request', requestId: 'inbox:e1' });
});

it.each(['before-ack', 'after-ack'] as const)('does not resolve a question after unmount (%s)', async (when) => {
  vi.useFakeTimers();
  let acknowledge!: (value: { ok: boolean }) => void;
  h.answer.mockReturnValue(new Promise(resolve => { acknowledge = resolve; }));
  const onResolved = vi.fn();
  const view = render(<CompanionQuestion request={request()} onBack={vi.fn()} onResolved={onResolved} />);
  fireEvent.click(screen.getByRole('button', { name: /Right/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  if (when === 'before-ack') view.unmount();
  await act(async () => acknowledge({ ok: true }));
  if (when === 'after-ack') view.unmount();
  act(() => vi.advanceTimersByTime(1000));
  expect(onResolved).not.toHaveBeenCalled();
});

it('picks with number keys and sends with Enter', async () => {
  renderQ();
  fireEvent.keyDown(window, { key: '1' });
  fireEvent.keyDown(window, { key: '9' });
  await act(async () => {
    fireEvent.keyDown(window, { key: 'Enter' });
  });
  expect(h.answer).toHaveBeenCalledWith('inbox:e1', 'Left (Recommended)');
});

it('Other text replaces the picked option', async () => {
  const { send } = renderQ();
  fireEvent.click(screen.getByRole('button', { name: /Left/ }));
  fireEvent.change(screen.getByPlaceholderText('Other…'), { target: { value: '  Up  ' } });
  await act(async () => {
    fireEvent.click(send());
  });
  expect(h.answer).toHaveBeenCalledWith('inbox:e1', 'Up');
});

it('labels each answer when there are several questions, and toggles multi-select', async () => {
  const { send } = renderQ(
    request({
      questions: [
        { prompt: 'Side?', options: [{ id: 'A', label: 'Left' }, { id: 'B', label: 'Right' }] },
        { prompt: 'Extras?', multiSelect: true, options: [{ id: 'x', label: 'Tests' }, { id: 'y', label: 'Docs' }] }
      ]
    })
  );
  fireEvent.click(screen.getByRole('button', { name: /Left/ }));
  fireEvent.click(screen.getByRole('button', { name: /Tests/ }));
  fireEvent.click(screen.getByRole('button', { name: /Docs/ }));
  fireEvent.click(screen.getByRole('button', { name: /Tests/ }));
  fireEvent.keyDown(window, { key: '2' }); // number keys only work on a single question
  await act(async () => {
    fireEvent.click(send());
  });
  expect(h.answer).toHaveBeenCalledWith('inbox:e1', 'Q1: Side?\nA: Left\n\nQ2: Extras?\nA: Docs');
});

it('replies free text to a blocked agent', async () => {
  const { send } = renderQ(request({ id: 'agent:s1', kind: 'blocked', entryId: undefined, questions: undefined }));
  expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  fireEvent.change(screen.getByPlaceholderText('Reply to the agent…'), { target: { value: 'go on' } });
  await act(async () => {
    fireEvent.click(send());
  });
  expect(h.answer).toHaveBeenCalledWith('agent:s1', 'go on');
});

it.each([
  [{ ok: false, reason: 'ended' }, 'The agent is no longer running.'],
  [{ ok: false, reason: 'weird' }, 'This request is no longer pending.'],
  [{ ok: false }, 'This request is no longer pending.']
])('explains a refused answer %o', async (res, copy) => {
  h.answer.mockResolvedValue(res);
  const { send, onResolved } = renderQ();
  fireEvent.click(screen.getByRole('button', { name: /Left/ }));
  await act(async () => {
    fireEvent.click(send());
  });
  expect(screen.getByRole('alert').textContent).toBe(copy);
  expect(onResolved).not.toHaveBeenCalled();
  expect((send() as HTMLButtonElement).disabled).toBe(false);
});

it('explains a transport failure', async () => {
  h.answer.mockRejectedValue(new Error('ipc'));
  const { send } = renderQ();
  fireEvent.click(screen.getByRole('button', { name: /Left/ }));
  await act(async () => {
    fireEvent.click(send());
  });
  expect(screen.getByRole('alert').textContent).toBe('Could not send the answer.');
});

it('routes an unanswerable request to the app instead of sending', () => {
  renderQ(request({ answerable: false, reason: 'background' }));
  expect(screen.getByText('Background job — answer it from the app.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  for (const btn of screen.getAllByRole('button', { name: 'Open in Zana' })) fireEvent.click(btn);
  fireEvent.keyDown(window, { key: 'Enter' });
  expect(h.open).toHaveBeenCalledTimes(2);
  expect(h.open).toHaveBeenCalledWith({ kind: 'request', requestId: 'inbox:e1' });
  expect(h.answer).not.toHaveBeenCalled();
});

it('a thread waiting on you is opened in the app, never answered from the rail', () => {
  renderQ(request({ id: 'thread:t1', kind: 'blocked', questions: undefined, threadId: 't1', answerable: false, reason: 'thread' }));
  expect(screen.getByText('Waiting in a thread — open it in the app to respond.')).toBeTruthy();
  expect(screen.queryByPlaceholderText('Reply to the agent…')).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: 'Open in Zana' })[0]);
  expect(h.open).toHaveBeenCalledWith({ kind: 'request', requestId: 'thread:t1' });
});

it('ignores Enter and number keys typed into the Other field', () => {
  renderQ();
  const other = screen.getByPlaceholderText('Other…');
  fireEvent.keyDown(other, { key: '2' });
  fireEvent.keyDown(other, { key: 'Enter' });
  expect(screen.getByRole('button', { name: /Right/ }).getAttribute('aria-pressed')).toBe('false');
  expect(h.answer).not.toHaveBeenCalled();
});

it('Back and Skip hand control back without answering', () => {
  const { onBack, onResolved } = renderQ();
  fireEvent.click(screen.getByRole('button', { name: 'Back to the list' }));
  fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Open in Zana' })[0]);
  expect(onBack).toHaveBeenCalledOnce();
  expect(onResolved).toHaveBeenCalledOnce();
  expect(h.open).toHaveBeenCalledOnce();
  expect(h.answer).not.toHaveBeenCalled();
});
