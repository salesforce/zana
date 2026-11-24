// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AskZanaPanel } from './app.tsx';
import { modelKey, noAssistant } from './assistant.js';

const host = vi.hoisted(() => {
  const call = vi.fn();
  return {
    call,
    rpc: { call },
    navigate: { openProviderSetup: vi.fn(), onProviderChange: vi.fn(), setPageContext: vi.fn() }
  };
});
vi.mock('@zana-ai/zcc-plugin-sdk/app', () => ({
  definePluginApp: (definition: unknown) => definition,
  useRpc: () => host.rpc,
  useZccNavigate: () => host.navigate
}));

const sonnet = { providerId: 'claude-code', modelId: 'sonnet', providerLabel: 'Claude Code', modelLabel: 'Sonnet' };
const haiku = { ...sonnet, modelId: 'haiku', modelLabel: 'Haiku' };
const available = { defaultModel: sonnet, models: [sonnet, haiku], selection: null };
afterEach(() => {
  const reset = screen.queryByRole('button', { name: 'New conversation' });
  if (reset) fireEvent.click(reset);
  cleanup();
  vi.resetAllMocks();
});

function ask(question: string) {
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: question } });
  fireEvent.submit(input.closest('form')!);
}

it('searches and shows an empty result without provider RPC, and preserves the draft through setup', async () => {
  host.call.mockResolvedValue(noAssistant);
  host.navigate.openProviderSetup.mockReturnValue(true);
  const panel = render(<AskZanaPanel />);
  await act(async () => {});
  ask('Why won’t Slack connect?');
  expect(screen.getByText('Troubleshoot a Slack connection')).toBeTruthy();
  expect(screen.getByText('Check your Slack account')).toBeTruthy();
  ask('What is the diameter of Jupiter?');
  expect(screen.getByRole('heading', { name: 'No matching guide' })).toBeTruthy();
  expect(host.call).toHaveBeenCalledExactlyOnceWith('status');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'How do I make a weekly schedule?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect an AI provider' }));
  expect(host.navigate.openProviderSetup).toHaveBeenCalledOnce();
  panel.unmount();
  render(<AskZanaPanel />);
  await act(async () => {});
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('How do I make a weekly schedule?');
});

it('applies an explicit model to a follow-up and falls back to offline help with the draft intact', async () => {
  const firstTurn = { question: 'Why won’t Slack connect?', answer: 'Check your linked Slack account.', sourceIds: ['slack'] };
  host.call
    .mockResolvedValueOnce(available)
    .mockResolvedValueOnce(firstTurn)
    .mockResolvedValueOnce({ ...available, selection: haiku })
    .mockRejectedValueOnce(new Error('Model unavailable'))
    .mockResolvedValueOnce({ defaultModel: sonnet, models: [sonnet], selection: haiku })
    .mockResolvedValueOnce({ ...available, models: [sonnet] });
  render(<AskZanaPanel />);
  await screen.findByRole('button', { name: 'Ask' });
  ask(firstTurn.question);
  await screen.findByText(firstTurn.answer);
  expect(screen.getByRole('heading', { name: 'Sources' })).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: /^Model/ }), { target: { value: modelKey(haiku) } });
  await act(async () => {});
  ask('Where are Slack settings?');
  await screen.findByText(/saved model is unavailable/i);
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Where are Slack settings?');
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  expect(host.call).toHaveBeenCalledWith('answer', {
    question: 'Where are Slack settings?', turns: [firstTurn], selection: haiku
  });
  fireEvent.click(screen.getByRole('button', { name: 'Use Zana default' }));
  await screen.findByRole('button', { name: 'Ask' });
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Where are Slack settings?');
});
