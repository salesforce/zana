// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FollowUp } from '@zana-ai/zcc-domain/product';
import { resetComposerSessions } from '@/components/composer/composer-session';

const answerFollowUp = vi.hoisted(() => vi.fn());
vi.mock('@/store', async (original) => ({ ...await original<typeof import('@/store')>(), answerFollowUp }));
import { useData, useFollowUps } from '@/store';
import { FollowUpsView } from './FollowUpsView';

const at = new Date().toISOString();
const followUp = { id: 'f1', projectId: 'p1', title: 'Pick a deployment path', kind: 'question', status: 'open', origin: { source: 'agent' }, createdAt: at, updatedAt: at } as FollowUp;
const openAnswer = () => {
  fireEvent.click(screen.getByText('Pick a deployment path'));
  return screen.getByRole('textbox', { name: 'Answer this follow-up' });
};

beforeEach(() => {
  resetComposerSessions();
  answerFollowUp.mockResolvedValue({ ok: true });
  useData.setState({ projects: [{ id: 'p1', name: 'Project', path: '/tmp/p1', createdAt: 0, lastActiveAt: 0 }] as never });
  useFollowUps.setState({ followups: [followUp], loading: false });
});
afterEach(cleanup);

it('keeps an unsent follow-up answer through leaving the view and clears it once sent', async () => {
  const first = render(<FollowUpsView />);
  fireEvent.change(openAnswer(), { target: { value: 'Use the blue/green path' } });
  first.unmount();
  render(<FollowUpsView />);
  const input = openAnswer();
  expect(input).toHaveProperty('value', 'Use the blue/green path');
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(answerFollowUp).toHaveBeenCalledWith(followUp, 'Use the blue/green path'));
  await waitFor(() => expect(input).toHaveProperty('value', ''));
  cleanup();
  render(<FollowUpsView />);
  expect(openAnswer()).toHaveProperty('value', '');
});
