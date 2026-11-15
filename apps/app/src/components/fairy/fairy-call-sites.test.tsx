// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  test: vi.fn(),
  pushToast: vi.fn(),
  sessions: undefined as unknown,
  load: vi.fn()
}));

vi.mock('../../lib/product-client.js', () => ({ product: { llmPrompts: { test: h.test } } }));
vi.mock('../../store.js', () => {
  const ui = { pushToast: h.pushToast, selectTab: vi.fn(), setProjectView: vi.fn() };
  return {
    useUi: (pick: (s: typeof ui) => unknown) => pick(ui),
    useData: (pick: (s: unknown) => unknown) =>
      pick({ claudeSessions: { p1: h.sessions }, loadClaudeSessions: h.load, createTerminal: vi.fn() })
  };
});
vi.mock('../Modal.js', () => ({
  Modal: ({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) => (
    <div role="dialog">{children}{footer}</div>
  )
}));

import { ImprovePromptButton } from '../ImprovePromptButton.js';
import { useAiEnhanceSelection } from '../AiEnhanceSelection.js';
import { ResumePicker } from '../ResumePicker.js';
import { ProviderCliBanner } from '../composer/ProviderCliBanner.js';
import { ThreadPromptModeCard } from '../thread/timeline/ThreadBanners.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.sessions = undefined;
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe('fairy spinner call sites', () => {
  it('ImprovePromptButton swaps its sparkle for the spinner while improving', async () => {
    const pending = deferred<{ ok: boolean; text: string }>();
    h.test.mockReturnValue(pending.promise);
    const onChange = vi.fn();
    const { container } = render(<ImprovePromptButton value="fix it" onChange={onChange} />);
    expect(container.querySelector('.fairy-spinner')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Improve prompt/ }));
    expect(screen.getByText('Improving…')).toBeTruthy();
    expect(container.querySelector('svg.fairy-spinner.improve-prompt-spin')).toBeTruthy();
    await act(async () => { pending.resolve({ ok: true, text: 'Fix the bug.' }); });
    expect(onChange).toHaveBeenCalledWith('Fix the bug.');
    expect(container.querySelector('.fairy-spinner')).toBeNull();
  });

  it('AI enhance selection shows the spinner while the call is running', async () => {
    const pending = deferred<{ ok: boolean; text: string; error?: string }>();
    h.test.mockReturnValue(pending.promise);
    let run: ((editor: unknown) => void) | undefined;
    const model = { getValueInRange: () => 'old', getOffsetAt: () => 0, getValue: () => 'old text' };
    const editor = {
      addAction: (action: { run: (e: unknown) => void }) => { run = action.run; },
      getModel: () => model,
      getSelection: () => ({ isEmpty: () => false, getStartPosition: () => ({}), getEndPosition: () => ({}) })
    };
    function Host() {
      const { registerEditor, modal } = useAiEnhanceSelection();
      return <>
        <button type="button" onClick={() => (registerEditor as unknown as (e: unknown) => void)(editor)}>mount</button>
        {modal}
      </>;
    }
    const { container } = render(<Host />);
    fireEvent.click(screen.getByText('mount'));
    act(() => run!(editor));
    expect(container.querySelector('.fairy-spinner')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Enhance/ }));
    expect(screen.getByText(/Enhancing…/)).toBeTruthy();
    expect(container.querySelector('svg.fairy-spinner')).toBeTruthy();
    await act(async () => { pending.resolve({ ok: false, text: '', error: 'offline' }); });
    expect(h.pushToast).toHaveBeenCalledWith('Couldn’t enhance selection: offline', 'error');
    expect(container.querySelector('.fairy-spinner')).toBeNull();
  });

  it('ProviderCliBanner shows the spinner for install and update actions', () => {
    const props = { displayName: 'Codex', currentVersion: null, minimumSupportedVersion: null, canRunAction: true, actionRunning: true, onAction: () => undefined };
    const installing = renderToStaticMarkup(<ProviderCliBanner {...props} installed={false} />);
    expect(installing).toContain('fairy-spinner');
    expect(installing).toContain('Installing…');
    const updating = renderToStaticMarkup(<ProviderCliBanner {...props} installed />);
    expect(updating).toContain('Updating…');
    const idle = renderToStaticMarkup(<ProviderCliBanner {...props} installed actionRunning={false} />);
    expect(idle).not.toContain('fairy-spinner');
    expect(idle).toContain('Update Codex');
    expect(renderToStaticMarkup(<ProviderCliBanner {...props} installed canRunAction={false} />)).not.toContain('<button');
  });

  it('plan mode exit shows the spinner while exiting', () => {
    const card = (isExitPending: boolean) => renderToStaticMarkup(
      <ThreadPromptModeCard mode={{ mode: 'plan' }} isExitPending={isExitPending} onOpenPlan={() => undefined} onExitPlanMode={() => undefined} />
    );
    expect(card(true)).toContain('fairy-spinner spin');
    expect(card(false)).not.toContain('fairy-spinner');
  });
});

describe('ResumePicker empty states', () => {
  const project = { id: 'p1', name: 'One', path: '/one' } as never;

  it('shows the fairy when the search has no matches', () => {
    h.sessions = [{ id: 'abc1234567', title: 'Refactor', firstUserPrompt: null, lastActiveAt: Date.now() }];
    const { container } = render(<ResumePicker project={project} onClose={() => undefined} />);
    expect(container.querySelector('.fairy-empty')).toBeNull();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'zzzzqqq' } });
    expect(container.querySelector('.fairy-empty .fairy-empty-title')?.textContent).toBe('No matches');
  });

  it('keeps the plain line when the folder has no sessions', () => {
    h.sessions = [];
    const { container } = render(<ResumePicker project={project} onClose={() => undefined} />);
    expect(screen.getByText('No previous Claude sessions for this folder.')).toBeTruthy();
    expect(container.querySelector('.fairy-empty')).toBeNull();
  });
});
