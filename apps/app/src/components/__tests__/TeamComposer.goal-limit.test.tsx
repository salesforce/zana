/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SquadLaunchPrefill } from '@zana-ai/zcc-domain/squad-proposal';

const h = vi.hoisted(() => ({
  goalText: '',
  images: [] as unknown[],
  captured: null as null | { onSubmit: () => void },
  startJob: vi.fn(),
  persistImages: vi.fn()
}));

vi.mock('../../lib/product-client.js', () => ({
  product: {
    executionSources: { pick: vi.fn() },
    projects: { ensureQuickAgent: vi.fn() },
    teams: { startJob: (...args: unknown[]) => h.startJob(...args) },
    fs: { uploadToRemote: vi.fn(), uploadProjectAttachmentToRemote: vi.fn() }
  }
}));

vi.mock('../../lib/prompt-attachments.js', () => ({ persistComposerImages: h.persistImages }));

const pushToast = vi.fn();
const dataState = { projects: [{ id: 'p1', name: 'Project One' }], loadProjects: vi.fn(async () => undefined) };

vi.mock('../../store.js', () => ({
  useData: Object.assign((selector: (s: typeof dataState) => unknown) => selector(dataState), { getState: () => dataState }),
  useTeams: (selector: (s: { teams: unknown[] }) => unknown) => selector({ teams: [{ id: 't1', name: 'Team One' }] }),
  useUi: (selector: (s: unknown) => unknown) => selector({ pushToast, openProjectSettings: vi.fn() })
}));

vi.mock('../composer/use-composer-prompt-field.js', () => ({
  useComposerPromptField: (opts: { onSubmit: () => void }) => {
    h.captured = opts;
    return {
      text: h.goalText,
      images: h.images,
      editor: null,
      dropOver: false,
      dropHandlers: {},
      canAttach: false,
      attachPickedFiles: vi.fn(),
      menuOpen: false,
      suggestions: [],
      highlighted: 0,
      triggerKind: null,
      applySuggestion: vi.fn(),
      handleChromeKeyDown: vi.fn(),
      typeaheadOpen: false,
      serialize: () => ({ text: h.goalText, mentions: [] }),
      clear: vi.fn(),
      captureRevision: () => 0,
      clearIfRevision: vi.fn(),
      insertText: vi.fn(),
      setText: vi.fn(),
      focus: vi.fn()
    };
  }
}));

vi.mock('../thread/voice/useVoiceInput.js', () => ({
  useVoiceInput: () => ({ state: 'idle', stream: null, stop: vi.fn(), cancel: vi.fn(), start: vi.fn(), isSupported: false, available: false, canStart: false })
}));
vi.mock('../ComposerProjectPicker.js', () => ({ ComposerProjectPicker: () => <div /> }));
vi.mock('../composer/ComposerPromptField.js', () => ({ ComposerPromptField: () => <div /> }));
vi.mock('../ui/PopoverPicklist.js', () => ({ PopoverPicklist: () => <div /> }));
vi.mock('../../plugins/PluginComposerChrome.js', () => ({
  PluginComposerChrome: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

import { TeamComposer } from '../TeamComposer.js';

const prefill = (summary = ''): SquadLaunchPrefill => ({
  proposalId: 'prop-1',
  projectId: 'p1',
  teamId: 't1',
  coordinationMode: 'structured',
  goal: 'x',
  title: '',
  summary,
  sources: []
});

const goalMessage = (n: number) =>
  `The goal is too long for a Squad (${n.toLocaleString('en-US')} of 2,048 characters). Move details into an attached plan or source.`;

describe('TeamComposer goal limit', () => {
  afterEach(() => {
    cleanup();
    h.goalText = '';
    h.images = [];
    h.startJob.mockReset();
    h.persistImages.mockReset();
  });

  it('blocks Launch over the limit, by click and by keyboard', async () => {
    h.goalText = 'a'.repeat(2049);
    render(<TeamComposer prefill={prefill()} />);
    expect(screen.getByTestId('team-goal-count').textContent).toBe('2,049 / 2,048');
    expect(screen.getByTestId('team-goal-limit-message').textContent).toBe(goalMessage(2049));
    const send = screen.getByTestId('team-command-send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(send.title).toBe('Goal is too long for a Squad');
    expect(send.getAttribute('aria-label')).toBe('Goal is too long for a Squad');
    fireEvent.click(send);
    await act(async () => { h.captured?.onSubmit(); });
    expect(h.startJob).not.toHaveBeenCalled();
    // The early guard sets no error; the later assembled-goal check would.
    expect(screen.queryByTestId('team-command-error')).toBeNull();
  });

  it('clears an earlier launch error when it refuses an over-limit goal', async () => {
    h.goalText = 'do it';
    h.startJob.mockResolvedValue({ ok: false, code: 'X', message: 'boom' });
    const view = render(<TeamComposer prefill={prefill()} />);
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(screen.getByTestId('team-command-error').textContent).toContain('boom'));
    h.goalText = 'a'.repeat(2049);
    view.rerender(<TeamComposer prefill={prefill()} />);
    await act(async () => { h.captured?.onSubmit(); });
    expect(screen.queryByTestId('team-command-error')).toBeNull();
    expect(screen.getByTestId('team-goal-limit-message').textContent).toBe(goalMessage(2049));
    expect(h.startJob).toHaveBeenCalledTimes(1);
  });

  it('launches a goal of exactly the limit', async () => {
    h.goalText = 'a'.repeat(2048);
    h.startJob.mockResolvedValue({ ok: true, value: {} });
    render(<TeamComposer prefill={prefill()} />);
    expect(screen.queryByTestId('team-goal-limit-message')).toBeNull();
    const send = screen.getByTestId('team-command-send') as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(h.startJob).toHaveBeenCalledTimes(1));
    expect(h.startJob.mock.calls[0]![0].goal).toHaveLength(2048);
  });

  it('shows no counter for a short goal', () => {
    h.goalText = 'a'.repeat(100);
    render(<TeamComposer prefill={prefill()} />);
    expect(screen.queryByTestId('team-goal-count')).toBeNull();
  });

  it('refuses a goal that image paths push over the limit', async () => {
    h.goalText = 'a'.repeat(2040);
    h.images = [{ id: 'i1' }];
    h.persistImages.mockResolvedValue(['/tmp/some/long/image-path.png']);
    render(<TeamComposer prefill={prefill()} />);
    fireEvent.click(screen.getByTestId('team-command-send'));
    const assembled = 2040 + 1 + '@/tmp/some/long/image-path.png'.length;
    await waitFor(() => expect(screen.getByTestId('team-command-error').textContent).toBe(goalMessage(assembled)));
    expect(h.startJob).not.toHaveBeenCalled();
  });

  it('caps the summary and blocks a stored summary over the limit', async () => {
    h.goalText = 'do it';
    render(<TeamComposer prefill={prefill('s'.repeat(2049))} />);
    expect((document.getElementById('team-summary') as HTMLTextAreaElement).maxLength).toBe(2048);
    expect(screen.getByTestId('team-summary-count').textContent).toBe('2,049 / 2,048');
    expect(screen.getByTestId('team-goal-limit-message').textContent).toContain('The summary is too long for a Squad');
    expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { h.captured?.onSubmit(); });
    expect(h.startJob).not.toHaveBeenCalled();
  });
});
