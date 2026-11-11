/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SquadLaunchPrefill } from '@zana-ai/zcc-domain/squad-proposal';
import { resolveAllLaunch } from '@zana-ai/zcc-domain/launch-options';

const h = vi.hoisted(() => ({
  goalText: '',
  images: [] as unknown[],
  captured: null as null | { onSubmit: () => void },
  startJob: vi.fn(),
  preview: vi.fn(),
  persistImages: vi.fn()
}));

vi.mock('../../lib/product-client.js', () => ({
  product: {
    executionSources: { pick: vi.fn() },
    projects: { ensureQuickAgent: vi.fn() },
    teams: { startJob: (...args: unknown[]) => h.startJob(...args), preview: async (input: unknown) => h.preview.getMockImplementation() ? h.preview(input) : ({ ok: true, value: { resolvedLaunch: resolveAllLaunch({}), location: { kind: 'project-root', projectId: 'p1' }, path: '/repo', branch: 'main' } }) },
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
    h.preview.mockReset();
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
    await waitFor(() => expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(false));
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
    await waitFor(() => expect(send.disabled).toBe(false));
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
    await waitFor(() => expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('team-command-send'));
    const assembled = 2040 + 1 + '@/tmp/some/long/image-path.png'.length;
    await waitFor(() => expect(screen.getByTestId('team-command-error').textContent).toBe(goalMessage(assembled)));
    expect(h.startJob).not.toHaveBeenCalled();
  });

  it('previews final assembled image goal and launches with its exact token', async () => {
    h.goalText = 'inspect image'; h.images = [{ id: 'image' }];
    h.persistImages.mockResolvedValue(['/tmp/image.png']);
    h.preview.mockImplementation(async (input: { goal: string }) => ({ ok: true, value: { resolvedLaunch: resolveAllLaunch({}), location: { kind: 'project-root', projectId: 'p1' }, path: '/repo', branch: 'main', previewToken: `token:${input.goal}` } }));
    h.startJob.mockResolvedValue({ ok: false, code: 'TEMPORARY', message: 'retry' });
    render(<TeamComposer prefill={prefill()} />);
    await waitFor(() => expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(h.startJob).toHaveBeenCalledOnce());
    const expected = 'inspect image\n@/tmp/image.png';
    expect(h.preview).toHaveBeenLastCalledWith(expect.objectContaining({ goal: expected }));
    expect(h.startJob.mock.calls[0]![0]).toMatchObject({ goal: expected, previewToken: `token:${expected}` });
    await waitFor(() => expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(h.startJob).toHaveBeenCalledTimes(2));
    expect(h.persistImages).toHaveBeenCalledOnce();
  });

  it('shows changed staged-image preview and waits for another Launch without persisting twice', async () => {
    h.goalText = 'inspect image'; h.images = [{ id: 'image' }];
    h.persistImages.mockResolvedValue(['/tmp/image.png']);
    h.preview.mockImplementation(async (input: { goal: string }) => ({ ok: true, value: { resolvedLaunch: resolveAllLaunch({ plan: { push: input.goal.includes('@/tmp') } }), location: { kind: 'project-root', projectId: 'p1' }, path: '/repo', branch: 'main', previewToken: `token:${input.goal}` } }));
    h.startJob.mockResolvedValue({ ok: true, value: {} });
    render(<TeamComposer prefill={prefill()} />);
    await waitFor(() => expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(screen.getByTestId('team-command-error').textContent).toContain('Launch preview changed'));
    expect(h.startJob).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Review settings' }));
    expect(screen.getByLabelText('Reviewed launch settings').textContent).toContain('Allowed (Plan)');
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(h.startJob).toHaveBeenCalledOnce());
    expect(h.persistImages).toHaveBeenCalledOnce();
  });

  it('reuses staged image paths after editing text and never reuses old goal token', async () => {
    h.goalText = 'old goal'; h.images = [{ id: 'image' }];
    h.persistImages.mockResolvedValue(['/tmp/image.png']);
    h.preview.mockImplementation(async (input: { goal: string }) => ({ ok: true, value: { resolvedLaunch: resolveAllLaunch({}), location: { kind: 'project-root', projectId: 'p1' }, path: '/repo', branch: 'main', previewToken: `token:${input.goal}` } }));
    h.startJob.mockResolvedValue({ ok: false, code: 'TEMPORARY', message: 'retry' });
    const view = render(<TeamComposer prefill={prefill()} />);
    await waitFor(() => expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(h.startJob).toHaveBeenCalledOnce());
    h.goalText = 'new goal'; view.rerender(<TeamComposer prefill={prefill()} />);
    await waitFor(() => expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(h.startJob).toHaveBeenCalledTimes(2));
    expect(h.startJob.mock.calls[1]![0]).toMatchObject({ goal: 'new goal\n@/tmp/image.png', previewToken: 'token:new goal\n@/tmp/image.png' });
    expect(h.persistImages).toHaveBeenCalledOnce();
  });

  it.each([[undefined], ['']])('rejects invalid persisted image path %s without preview or launch', async path => {
    h.goalText = 'image'; h.images = [{ id: 'image' }];
    h.persistImages.mockResolvedValue([path]);
    render(<TeamComposer prefill={prefill()} />);
    await waitFor(() => expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(screen.getByTestId('team-command-error').textContent).toContain('invalid attachment path'));
    expect(h.startJob).not.toHaveBeenCalled();
  });

  it('does not launch old input if text changes during image persistence', async () => {
    h.goalText = 'old'; h.images = [{ id: 'image' }];
    let finish!: (paths: string[]) => void;
    h.persistImages.mockImplementation(() => new Promise<string[]>(resolve => { finish = resolve; }));
    const view = render(<TeamComposer prefill={prefill()} />);
    await waitFor(() => expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('team-command-send'));
    h.goalText = 'new'; view.rerender(<TeamComposer prefill={prefill()} />);
    await act(async () => { finish(['/tmp/image.png']); });
    await waitFor(() => expect(screen.getByTestId('team-command-error').textContent).toContain('Composer changed'));
    expect(h.startJob).not.toHaveBeenCalled();
  });

  it('fails closed when final staged-goal preview fails; retries staging from cached paths', async () => {
    h.goalText = 'image'; h.images = [{ id: 'image' }];
    h.persistImages.mockResolvedValue(['/tmp/image.png']);
    h.preview.mockImplementation(async (input: { goal: string }) => input.goal.includes('@/tmp')
      ? { ok: false, message: 'source expired' }
      : { ok: true, value: { resolvedLaunch: resolveAllLaunch({}), location: { kind: 'project-root', projectId: 'p1' }, path: '/repo', branch: 'main' } });
    render(<TeamComposer prefill={prefill()} />);
    await waitFor(() => expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(screen.getByTestId('team-command-error').textContent).toContain('source expired'));
    expect(h.startJob).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(h.preview).toHaveBeenCalledTimes(3));
    expect(h.persistImages).toHaveBeenCalledOnce();
    expect(h.startJob).not.toHaveBeenCalled();
  });

  it('caps the summary and blocks a stored summary over the limit', async () => {
    h.goalText = 'do it';
    render(<TeamComposer prefill={prefill('s'.repeat(2049))} />);
    fireEvent.click(screen.getByRole('button', { name: /^Customize launch/ }));
    expect((document.getElementById('team-summary') as HTMLTextAreaElement).maxLength).toBe(2048);
    expect(screen.getByTestId('team-summary-count').textContent).toBe('2,049 / 2,048');
    expect(screen.getByTestId('team-goal-limit-message').textContent).toContain('The summary is too long for a Squad');
    expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { h.captured?.onSubmit(); });
    expect(h.startJob).not.toHaveBeenCalled();
  });
});
