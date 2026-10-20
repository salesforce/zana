// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FollowUp } from '@zana-ai/zcc-domain/product';
import { useData, useFollowUps } from '@/store';
import { FollowUpsView } from './FollowUpsView';

beforeEach(() => vi.stubGlobal('navigator', { ...navigator, platform: 'Win32' }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('spells follow-up send and save shortcuts as Ctrl+Enter on Windows', () => {
  const at = new Date().toISOString();
  const followUp = { id: 'f1', projectId: 'p1', title: 'Pick a deployment path', kind: 'question', status: 'open', origin: { source: 'agent' }, createdAt: at, updatedAt: at } as FollowUp;
  useData.setState({ projects: [{ id: 'p1', name: 'Project', path: '/tmp/p1', createdAt: 0, lastActiveAt: 0 }] as never });
  useFollowUps.setState({ followups: [followUp], loading: false });
  render(<FollowUpsView />);
  fireEvent.click(screen.getByText('Pick a deployment path'));
  expect(screen.getByText('Ctrl+Enter to send · resolves this follow-up')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /new follow-up/i }));
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Ship it' } });
  expect(screen.getByTitle('Ctrl+Enter to save')).toBeTruthy();
});
