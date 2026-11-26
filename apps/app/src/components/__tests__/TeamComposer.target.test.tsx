/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const startJob = vi.fn();
const previewJob = vi.fn();
const listWorktrees = vi.fn();
const pushToast = vi.fn();
const loadProjects = vi.fn(async () => undefined);

vi.mock('../../lib/product-client.js', () => ({
  product: {
    executionSources: { pick: vi.fn() },
    projects: { ensureQuickAgent: vi.fn(async () => ({ ok: false as const, code: 'no-op' })) },
    teams: { startJob: (...args: unknown[]) => startJob(...args), preview: (...args: unknown[]) => previewJob(...args) },
    git: { listWorktrees: (...args: unknown[]) => listWorktrees(...args) },
    fs: { uploadToRemote: vi.fn(), uploadProjectAttachmentToRemote: vi.fn() }
  }
}));

const projectsFixture = [
  { id: 'p1', name: 'Project One', path: '/repos/one' },
  { id: 'p2', name: 'Project Two', path: '/repos/two' },
  { id: 'pr', name: 'Remote', path: '/srv/remote', remote: { host: 'box' } }
];
const teamsFixture = [{ id: 't1', name: 'Team One' }];
const dataState = { projects: projectsFixture, loadProjects };

vi.mock('../../store.js', () => ({
  useData: Object.assign(
    (selector: (s: typeof dataState) => unknown) => selector(dataState),
    { getState: () => dataState }
  ),
  useTeams: (selector: (s: { teams: typeof teamsFixture }) => unknown) => selector({ teams: teamsFixture }),
  useUi: (selector: (s: { pushToast: typeof pushToast; openProjectSettings: () => void }) => unknown) =>
    selector({ pushToast, openProjectSettings: vi.fn() })
}));

vi.mock('../composer/use-composer-prompt-field.js', () => ({
  useComposerPromptField: () => ({
    text: 'do the thing', images: [], editor: null, dropOver: false, dropHandlers: {}, canAttach: false,
    attachPickedFiles: vi.fn(), menuOpen: false, suggestions: [], highlighted: 0, triggerKind: null,
    applySuggestion: vi.fn(), handleChromeKeyDown: vi.fn(), typeaheadOpen: false,
    serialize: () => ({ text: 'do the thing', mentions: [] }),
    clear: vi.fn(), captureRevision: () => 0, clearIfRevision: vi.fn(),
    insertText: vi.fn(), setText: vi.fn(), focus: vi.fn()
  })
}));

vi.mock('../thread/voice/useVoiceInput.js', () => ({
  useVoiceInput: () => ({
    state: 'idle', stream: null, stop: vi.fn(), cancel: vi.fn(), start: vi.fn(),
    isSupported: false, available: false, canStart: false
  })
}));

vi.mock('../ComposerProjectPicker.js', () => ({
  ComposerProjectPicker: ({ projects, onChange }: { projects: ReadonlyArray<{ id: string; name: string }>; onChange: (id: string) => void }) => (
    <div>
      {projects.map((p) => (
        <button key={p.id} type="button" data-testid={`pick-project-${p.id}`} onClick={() => onChange(p.id)}>{p.name}</button>
      ))}
    </div>
  )
}));

vi.mock('../composer/ComposerPromptField.js', () => ({ ComposerPromptField: () => <div /> }));

vi.mock('../ui/PopoverPicklist.js', () => ({
  PopoverPicklist: ({ id, ariaLabel, value, options, onChange, disabled }: {
    id: string; ariaLabel: string; value: string;
    options: ReadonlyArray<{ value: string; label: string }>; onChange: (v: string) => void; disabled?: boolean;
  }) => (
    <div data-testid={`picklist-${id}`} aria-label={ariaLabel} data-value={value} data-disabled={String(Boolean(disabled))}>
      {options.map((o) => (
        <button key={o.value} type="button" disabled={disabled} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}));

vi.mock('../../plugins/PluginComposerChrome.js', () => ({
  PluginComposerChrome: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

import { TeamComposer } from '../TeamComposer.js';
import { resolveAllLaunch } from '@zana-ai/zcc-domain/launch-options';

const worktree = (branch: string, extra: Record<string, unknown> = {}) => ({
  path: `/wt/${branch}`, branch, isMain: false, bare: false, detached: false, ...extra
});
const mainWt = worktree('main', { path: '/repos/one', isMain: true });

async function launchAndGetPayload() {
  await waitFor(() => expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByTestId('team-command-send'));
  await waitFor(() => expect(startJob).toHaveBeenCalledOnce());
  return startJob.mock.calls[0]![0] as Record<string, unknown>;
}

function settingsButton() {
  return screen.getByRole('button', { name: /^Launch settings/ });
}

function openSettings() {
  const button = settingsButton();
  if (button.getAttribute('aria-expanded') === 'false') fireEvent.click(button);
}

function pick(label: string, option: string | RegExp) {
  fireEvent.click(within(screen.getByLabelText(label)).getByRole('button', { name: option }));
}

function reviewedSettings() {
  return screen.getByLabelText('Reviewed launch settings');
}

describe('TeamComposer Squad target picker', () => {
  beforeEach(() => {
    previewJob.mockImplementation(async (input) => ({ ok: true, value: { resolvedLaunch: resolveAllLaunch({ launch: Object.fromEntries(Object.entries(input).filter(([key]) => ['worktree', 'onComplete', 'push', 'checks', 'failurePolicyDefault', 'target'].includes(key))) }), location: { kind: 'project-root', projectId: input.projectId }, path: '/repos/one', branch: 'main', fingerprint: 'v1', launchOptions: {} } }));
    startJob.mockResolvedValue({ ok: true, value: { executionId: 'e1', state: 'RUNNING' } });
    listWorktrees.mockResolvedValue([mainWt, worktree('feat/a'), worktree('feat/b')]);
  });
  afterEach(() => {
    previewJob.mockReset();
    cleanup();
    startJob.mockReset();
    listWorktrees.mockReset();
    pushToast.mockClear();
  });

  it('offers new worktree when no linked worktree is available', async () => {
    listWorktrees.mockResolvedValue([mainWt, worktree('x', { detached: true }), worktree('y', { bare: true })]);
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    await waitFor(() => expect(listWorktrees).toHaveBeenCalledWith('/repos/one'));
    await Promise.resolve();
    expect(within(screen.getByLabelText('Squad target')).getByRole('button', { name: /^New worktree/ })).toBeTruthy();
  });

  it('offers checkout choices if linked worktree discovery fails', async () => {
    listWorktrees.mockRejectedValue(new Error('boom'));
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    await waitFor(() => expect(listWorktrees).toHaveBeenCalled());
    expect(within(screen.getByLabelText('Squad target')).getByRole('button', { name: /^New worktree/ })).toBeTruthy();
  });

  it('shows defaults, Project, new worktree, and linked worktrees', async () => {
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    const picker = await screen.findByLabelText('Squad target');
    await within(picker).findByRole('button', { name: 'Worktree · feat/b' });
    const labels = Array.from(picker.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual(['Use defaults', 'Project · main', 'New worktree from main', 'Worktree · feat/a', 'Worktree · feat/b']);
  });

  it('bounds branch discovery display to registered project worktrees', async () => {
    listWorktrees.mockResolvedValue([mainWt, ...Array.from({ length: 500 }, (_, index) => worktree(`feature/${index}`))]);
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    const picker = await screen.findByLabelText('Squad target');
    expect(picker.querySelectorAll('button').length).toBeLessThanOrEqual(258);
    expect(listWorktrees).toHaveBeenCalledWith('/repos/one');
  });

  it('sends a project-root target', async () => {
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    const picker = await screen.findByLabelText('Squad target');
    fireEvent.click(screen.getByRole('button', { name: /^Project (checkout|· main)$/ }));
    await waitFor(() => expect(picker.getAttribute('data-value')).toBe('project-root'));
    expect(await launchAndGetPayload()).toMatchObject({ projectId: 'p1', target: { kind: 'project-root' } });
  });

  it('forwards explicit launch policies and shows resolved values with sources', async () => {
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    openSettings();
    pick('Squad target', /^New worktree/);
    pick('On complete', 'Keep checkout and branch');
    pick('Push', 'Do not push');
    pick('Named checks mode', 'Named checks');
    fireEvent.change(screen.getByLabelText('Named checks input'), { target: { value: 'unit, lint' } });
    openSettings();
    await waitFor(() => expect(reviewedSettings().textContent).toContain('Blocked (This launch)'));
    const payload = await launchAndGetPayload();
    expect(payload).toMatchObject({ worktree: true, onComplete: 'leave', push: false, checks: ['unit', 'lint'] });
    expect(payload).not.toHaveProperty('failurePolicyDefault');
    expect(reviewedSettings().textContent).toContain('Fail run (Default)');
  });

  it('reveals the full path, policy picklists and effective values together', async () => {
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    expect(settingsButton().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Effective launch settings')).toBeNull();
    expect(screen.queryByLabelText('Push')).toBeNull();

    openSettings();
    await waitFor(() => expect(reviewedSettings().textContent).toContain('Blocked (Default)'));
    const effective = screen.getByLabelText('Effective launch settings');
    expect(effective.textContent).toContain('main · /repos/one');
    expect(within(effective).getByTestId('precedence-launch.options').textContent).toMatch(/This launch.*Plan.*Squad.*Built-in default/);
    expect(screen.getByLabelText('On complete')).toBeTruthy();
    expect(screen.getByLabelText('Push')).toBeTruthy();
    expect(screen.getByLabelText('Named checks mode')).toBeTruthy();
    expect(screen.queryByLabelText('Named checks input')).toBeNull();
    expect(screen.getByLabelText('Title Optional')).toBeTruthy();
    expect(screen.getByLabelText('Summary Optional')).toBeTruthy();
    fireEvent.click(settingsButton());
    expect(screen.queryByLabelText('Reviewed launch settings')).toBeNull();
  });

  it('keeps user-owned checkouts and restores the generated-worktree policy when reselected', async () => {
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    openSettings();
    pick('Squad target', /^New worktree/);
    pick('On complete', 'Merge then remove');
    pick('Squad target', /^Project (checkout|· main)$/);
    const completion = screen.getByLabelText('On complete');
    expect(completion.getAttribute('data-value')).toBe('leave');
    expect(completion.getAttribute('data-disabled')).toBe('true');
    await waitFor(() => expect(previewJob).toHaveBeenLastCalledWith(expect.objectContaining({ target: { kind: 'project-root' }, onComplete: 'leave' })));
    pick('Squad target', /^New worktree/);
    expect(completion.getAttribute('data-value')).toBe('merge');
    expect(await launchAndGetPayload()).toMatchObject({ worktree: true, onComplete: 'merge' });
  });

  it('updates override badge and clears it when controls return to inheritance', async () => {
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    openSettings();

    pick('On complete', 'Keep checkout and branch');
    pick('Push', 'Allow push');
    pick('Named checks mode', 'Named checks');
    fireEvent.change(screen.getByLabelText('Named checks input'), { target: { value: 'unit' } });
    expect(screen.getByRole('button', { name: /^Launch settings.*3/ })).toBeTruthy();

    pick('On complete', 'Use default');
    pick('Push', 'Use default');
    pick('Named checks mode', 'Use default');
    expect(screen.getByRole('button', { name: /^Launch settings$/ })).toBeTruthy();
  });

  it('keeps inherited destructive risks visible while review details stay collapsed', async () => {
    render(<TeamComposer resolveLaunchPreview={async () => resolveAllLaunch({ plan: { push: true, onComplete: 'merge' } })} />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    await waitFor(() => expect(screen.getByLabelText('Launch policy notices').textContent).toContain('Push allowed (plan)'));
    expect(screen.getByLabelText('Launch policy notices').textContent).toContain('Merge on completion (plan)');
    expect(screen.getByLabelText('Launch policy notices').textContent).not.toContain('push: true (plan)');
  });

  it('uses real product preview by default and disables launch while pending or failed', async () => {
    let settle!: (value: unknown) => void;
    previewJob.mockImplementation(() => new Promise((resolve) => { settle = resolve; }));
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    await waitFor(() => expect(previewJob).toHaveBeenCalled());
    expect(settingsButton().getAttribute('aria-expanded')).toBe('false');
    expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(true);
    settle({ ok: false, code: 'INVALID_PLAN', message: 'Plan cannot be parsed' });
    await waitFor(() => expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(true));
    openSettings();
    await waitFor(() => expect(screen.getByLabelText('Effective launch settings').textContent).toContain('Plan cannot be parsed'));
    expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText('Effective launch settings').textContent).not.toContain('push: false (default)');
  });

  it('clears stale authoritative preview when target changes and ignores late responses', async () => {
    const pending: Array<(value: unknown) => void> = [];
    previewJob.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    await waitFor(() => expect(pending.length).toBeGreaterThan(0));
    const old = pending.at(-1)!;
    await screen.findByRole('button', { name: 'Worktree · feat/b' });
    fireEvent.click(screen.getByRole('button', { name: 'Worktree · feat/b' }));
    await waitFor(() => expect(pending.length).toBeGreaterThan(1));
    openSettings();
    old({ ok: true, value: { resolvedLaunch: resolveAllLaunch({ plan: { push: true } }), location: { kind: 'project-root', projectId: 'p1' }, path: '/old', branch: 'old' } });
    await Promise.resolve();
    expect(screen.getByLabelText('Effective launch settings').textContent).not.toContain('/old');
    expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(true);
    pending.at(-1)!({ ok: true, value: { resolvedLaunch: resolveAllLaunch({}), location: { kind: 'worktree', projectId: 'p1', branch: 'feat/b', ownership: 'user' }, path: '/wt/feat/b', branch: 'feat/b' } });
    await waitFor(() => expect(screen.getByLabelText('Effective launch settings').textContent).toContain('/wt/feat/b'));
  });

  it('fails closed on missing product preview and rejected transport', async () => {
    previewJob.mockRejectedValue(new Error('preview transport down'));
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    openSettings();
    await waitFor(() => expect(screen.getByLabelText('Effective launch settings').textContent).toContain('preview transport down'));
    expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(true);
    expect(startJob).not.toHaveBeenCalled();
  });

  it('resolves current form through host callback, including sources and goal', async () => {
    const resolveLaunchPreview = vi.fn(async () => resolveAllLaunch({ plan: { push: true, checks: ['unit'] } }));
    render(<TeamComposer resolveLaunchPreview={resolveLaunchPreview} />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    openSettings();
    await waitFor(() => expect(resolveLaunchPreview).toHaveBeenCalledWith(expect.objectContaining({ teamId: 't1', projectId: 'p1', goal: 'do the thing', sourceCapabilityIds: [] })));
    pick('Push', 'Do not push');
    await waitFor(() => expect(resolveLaunchPreview).toHaveBeenLastCalledWith(expect.objectContaining({ push: false })));
  });

  it('returns policy controls to inheritance and refuses blank named checks', async () => {
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    openSettings();
    pick('Push', 'Allow push');
    pick('Push', 'Use default');
    pick('Named checks mode', 'Named checks');
    expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(true);
    pick('Named checks mode', 'Use default');
    openSettings();
    await waitFor(() => expect(reviewedSettings().textContent).toContain('Blocked (Default)'));
    const payload = await launchAndGetPayload();
    expect(payload).not.toHaveProperty('push');
    expect(payload).not.toHaveProperty('checks');
  });

  it('forwards explicit no-checks policy', async () => {
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    openSettings();
    pick('Named checks mode', 'No checks');

    const payload = await launchAndGetPayload();
    expect(payload).toHaveProperty('checks', []);
  });

  it('keeps bound reviewed project and target when project-change callback is invoked', async () => {
    render(<TeamComposer prefill={{ proposalId: 'proposal', projectId: 'p1', teamId: 't1', coordinationMode: 'freeform', goal: 'ship', sources: [], launchOptions: { target: { kind: 'worktree', branch: 'feat/a' }, push: false } }} />);
    await screen.findByRole('button', { name: 'Worktree · feat/a' });
    expect(screen.getByLabelText('Squad target').getAttribute('data-value')).toBe('worktree:feat/a');
    fireEvent.click(screen.getByTestId('pick-project-p2'));
    const payload = await launchAndGetPayload();
    expect(listWorktrees).not.toHaveBeenCalledWith('/repos/two');
    expect(payload).toMatchObject({ projectId: 'p1', target: { kind: 'worktree', branch: 'feat/a' }, proposalId: 'proposal' });
  });

  it('locks bound reviewed policies and target and labels fixed reviewed values', async () => {
    const options = { target: { kind: 'worktree' as const, branch: 'feat/a' }, push: true, checks: ['unit'], onComplete: 'leave' as const };
    render(<TeamComposer prefill={{ proposalId: 'proposal', projectId: 'p1', teamId: 't1', coordinationMode: 'freeform', goal: 'ship', sources: [], launchOptions: options, launchPreview: { launchOptions: options, resolvedLaunch: resolveAllLaunch({ launch: options }), location: { kind: 'worktree', projectId: 'p1', branch: 'feat/a', ownership: 'user' }, path: '/wt/feat/a', branch: 'feat/a', fingerprint: 'reviewed' } }} />);
    await screen.findByRole('button', { name: 'Worktree · feat/a' });
    expect(screen.queryByLabelText('Worktree isolation')).toBeNull();
    expect(screen.queryByLabelText('On complete')).toBeNull();
    expect(screen.queryByLabelText('Push')).toBeNull();
    expect(screen.queryByLabelText('Named checks mode')).toBeNull();
    expect(screen.queryByLabelText('Failure policy')).toBeNull();
    expect(settingsButton().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Reviewed launch settings')).toBeNull();
    openSettings();
    expect(screen.getByText('Reviewed launch policies and target are fixed. Prepare a new proposal to change them.')).toBeTruthy();
    await waitFor(() => expect(reviewedSettings().textContent).toContain('Allowed (This launch)'));
    openSettings();
    expect(screen.getByLabelText('Title Optional')).toBeTruthy();
    expect(screen.getByLabelText('Summary Optional')).toBeTruthy();
    expect(screen.queryByLabelText('Push')).toBeNull();
    const picker = screen.getByLabelText('Squad target');
    expect(picker.getAttribute('data-disabled')).toBe('true');
    expect(await launchAndGetPayload()).toMatchObject({ proposalId: 'proposal', ...options });
  });

  it('forwards opaque main-issued preview token on ordinary launch, never fingerprint', async () => {
    previewJob.mockResolvedValue({ ok: true, value: { launchOptions: {}, resolvedLaunch: resolveAllLaunch({}), location: { kind: 'project-root', projectId: 'p1' }, path: '/repos/one', branch: 'main', fingerprint: 'not-authorization', previewToken: 'opaque-main-token' } });
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    openSettings();
    const payload = await launchAndGetPayload();
    expect(payload).toHaveProperty('previewToken', 'opaque-main-token');
    expect(payload).not.toHaveProperty('fingerprint');
    expect(payload).not.toHaveProperty('launchPreview');
  });

  it('refreshes an expired unchanged token before each launch click', async () => {
    let now = 0;
    let sequence = 0;
    const proofs = new Map<string, number>();
    previewJob.mockImplementation(async () => {
      const previewToken = `proof-${++sequence}`;
      proofs.set(previewToken, now);
      return { ok: true, value: { resolvedLaunch: resolveAllLaunch({}), location: { kind: 'project-root', projectId: 'p1' }, path: '/repos/one', branch: 'main', previewToken } };
    });
    startJob.mockImplementation(async ({ previewToken }) => now - proofs.get(previewToken)! < 300_000
      ? { ok: true, value: {} } : { ok: false, code: 'STALE_PREVIEW', message: 'proof expired' });
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    await waitFor(() => expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(false));
    now = 300_001;
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(startJob).toHaveBeenCalledOnce());
    expect(startJob.mock.calls[0]![0].previewToken).toBe('proof-2');
    expect(pushToast).toHaveBeenCalledWith('Squad launched. Open Agents board to monitor it.');
  });

  it.each(['REQUIREMENT_UNAVAILABLE', 'CAPABILITY_AVAILABILITY_UNKNOWN', 'TEMPORARY', 'THROWN'])('invalidates consumed proof after %s and blocks Retry until refresh completes', async code => {
    let sequence = 0;
    let finish!: (value: unknown) => void;
    const consumed = new Set<string>();
    const makePreview = () => ({ ok: true, value: { resolvedLaunch: resolveAllLaunch({}), location: { kind: 'project-root', projectId: 'p1' }, path: '/repos/one', branch: 'main', previewToken: `proof-${++sequence}` } });
    previewJob.mockImplementation(() => previewJob.mock.calls.length === 3
      ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(makePreview()));
    startJob.mockImplementation(async ({ previewToken }) => {
      expect(consumed.has(previewToken)).toBe(false);
      consumed.add(previewToken);
      if (startJob.mock.calls.length > 1) return { ok: true, value: {} };
      if (code === 'THROWN') throw new Error('launch transport lost after consume');
      return { ok: false, code, message: 'retry', ...(code === 'REQUIREMENT_UNAVAILABLE' ? { requirementFailure: { workUnits: [] } } : {}), ...(code === 'CAPABILITY_AVAILABILITY_UNKNOWN' ? { availabilityUnknown: { failedSources: ['skills'], message: 'offline' } } : {}) };
    });
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    await launchAndGetPayload();
    await waitFor(() => expect(previewJob).toHaveBeenCalledTimes(3));
    expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(true);
    if (code === 'CAPABILITY_AVAILABILITY_UNKNOWN') expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(true);
    openSettings();
    expect(reviewedSettings().textContent).toContain('Blocked (Default)');
    await act(async () => { finish(makePreview()); });
    await waitFor(() => expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(code === 'CAPABILITY_AVAILABILITY_UNKNOWN' ? screen.getByRole('button', { name: 'Retry' }) : screen.getByTestId('team-command-send'));
    await waitFor(() => expect(startJob).toHaveBeenCalledTimes(2));
    expect(startJob.mock.calls[0]![0].previewToken).toBe('proof-2');
    expect(startJob.mock.calls[1]![0].previewToken).toBe('proof-4');
    expect(previewJob).toHaveBeenCalledTimes(4);
  });

  it('requires another human Launch when unchanged-input fresh preview drifts', async () => {
    let sequence = 0;
    previewJob.mockImplementation(async () => ({ ok: true, value: { resolvedLaunch: resolveAllLaunch({ plan: { push: ++sequence > 1 } }), location: { kind: 'project-root', projectId: 'p1' }, path: '/repos/one', branch: 'main', previewToken: `proof-${sequence}` } }));
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    openSettings();
    await waitFor(() => expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(screen.getByTestId('team-command-error').textContent).toContain('Launch preview changed'));
    expect(startJob).not.toHaveBeenCalled();
    expect(reviewedSettings().textContent).toContain('Allowed (Plan)');
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(startJob).toHaveBeenCalledOnce());
    expect(startJob.mock.calls[0]![0].previewToken).toBe('proof-3');
  });

  it('shows location drift from post-failure refresh without launching automatically', async () => {
    let sequence = 0;
    previewJob.mockImplementation(async () => ({ ok: true, value: { resolvedLaunch: resolveAllLaunch({}), location: { kind: 'project-root', projectId: 'p1' }, path: '/repos/one', branch: ++sequence > 2 ? 'changed' : 'main', previewToken: `proof-${sequence}` } }));
    startJob.mockResolvedValueOnce({ ok: false, code: 'TEMPORARY', message: 'consumed' });
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    openSettings();
    await launchAndGetPayload();
    await waitFor(() => expect(screen.getByTestId('team-command-error').textContent).toContain('Launch preview changed'));
    expect(screen.getByLabelText('Effective launch settings').textContent).toContain('changed · /repos/one');
    expect(startJob).toHaveBeenCalledOnce();
    expect(previewJob).toHaveBeenCalledTimes(3);
  });

  it('bounds rejected post-failure refresh and ignores duplicate clicks while proof request is pending', async () => {
    let finish!: (value: unknown) => void;
    const preview = { ok: true, value: { resolvedLaunch: resolveAllLaunch({}), location: { kind: 'project-root', projectId: 'p1' }, path: '/repos/one', branch: 'main', previewToken: 'proof' } };
    previewJob.mockResolvedValueOnce(preview).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ ok: false, message: 'refresh unavailable' });
    startJob.mockResolvedValue({ ok: false, code: 'TEMPORARY', message: 'consumed' });
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    openSettings();
    openSettings();
    await waitFor(() => expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('team-command-send'));
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(previewJob).toHaveBeenCalledTimes(2));
    expect(startJob).not.toHaveBeenCalled();
    await act(async () => { finish(preview); });
    await waitFor(() => expect(screen.getByLabelText('Effective launch settings').textContent).toContain('refresh unavailable'));
    expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(true);
    expect(startJob).toHaveBeenCalledOnce();
    expect(previewJob).toHaveBeenCalledTimes(3);
  });

  it('keeps missing launch declarations inherited while bound reviewed controls stay locked', async () => {
    previewJob.mockResolvedValue({ ok: true, value: { launchOptions: {}, resolvedLaunch: resolveAllLaunch({ plan: { push: true } }), location: { kind: 'project-root', projectId: 'p1' }, path: '/repos/one', branch: 'main', fingerprint: 'reviewed' } });
    render(<TeamComposer prefill={{ proposalId: 'proposal', projectId: 'p1', teamId: 't1', coordinationMode: 'freeform', goal: 'ship', sources: [], launchPreview: { launchOptions: {}, resolvedLaunch: resolveAllLaunch({ plan: { push: true } }), location: { kind: 'project-root', projectId: 'p1' }, path: '/repos/one', branch: 'main', fingerprint: 'reviewed' } }} />);
    expect(screen.queryByLabelText('Push')).toBeNull();
    openSettings();
    await waitFor(() => expect(reviewedSettings().textContent).toContain('Allowed (Plan)'));
    const payload = await launchAndGetPayload();
    expect(payload).toHaveProperty('proposalId', 'proposal');
    expect(payload).not.toHaveProperty('push');
    expect(payload).not.toHaveProperty('previewToken');
  });

  it('sends only refreshed token after launch options change', async () => {
    let refresh!: (value: unknown) => void;
    previewJob.mockResolvedValueOnce({ ok: true, value: { launchOptions: {}, resolvedLaunch: resolveAllLaunch({}), location: { kind: 'project-root', projectId: 'p1' }, path: '/repos/one', branch: 'main', fingerprint: 'v1', previewToken: 'old-token' } });
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    await waitFor(() => expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(false));
    previewJob.mockImplementationOnce(() => new Promise((resolve) => { refresh = resolve; }));
    openSettings();
    pick('Push', 'Allow push');
    expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText('Effective launch settings').textContent).not.toContain('push: false (default)');
    await waitFor(() => expect(refresh).toBeTypeOf('function'));
    const refreshed = { ok: true, value: { launchOptions: { push: true }, resolvedLaunch: resolveAllLaunch({ launch: { push: true } }), location: { kind: 'project-root', projectId: 'p1' }, path: '/repos/one', branch: 'main', fingerprint: 'v2', previewToken: 'new-token' } };
    previewJob.mockResolvedValue(refreshed);
    refresh(refreshed);
    expect(await launchAndGetPayload()).toMatchObject({ push: true, previewToken: 'new-token' });
  });

  it('sends a worktree target by branch', async () => {
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    await screen.findByLabelText('Squad target');
    fireEvent.click(screen.getByRole('button', { name: 'Worktree · feat/b' }));
    expect(await launchAndGetPayload()).toMatchObject({ target: { kind: 'worktree', branch: 'feat/b' } });
  });

  it('sends no target when defaults are selected', async () => {
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    await screen.findByLabelText('Squad target');
    fireEvent.click(screen.getByRole('button', { name: /^Project (checkout|· main)$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Use defaults' }));
    const payload = await launchAndGetPayload();
    expect(payload).not.toHaveProperty('target');
  });

  it('resets the choice when the Project changes', async () => {
    listWorktrees.mockImplementation(async (path: string) =>
      path === '/repos/one' ? [mainWt, worktree('feat/a')] : [worktree('main', { isMain: true, path: '/repos/two' }), worktree('other')]
    );
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    await screen.findByLabelText('Squad target');
    fireEvent.click(screen.getByRole('button', { name: 'Worktree · feat/a' }));
    expect(screen.getByLabelText('Squad target').getAttribute('data-value')).toBe('worktree:feat/a');

    fireEvent.click(screen.getByTestId('pick-project-p2'));
    await waitFor(() => expect(listWorktrees).toHaveBeenCalledWith('/repos/two'));
    await screen.findByRole('button', { name: 'Worktree · other' });
    expect(screen.getByLabelText('Squad target').getAttribute('data-value')).toBe('');
    expect(screen.queryByRole('button', { name: 'Worktree · feat/a' })).toBeNull();
    expect(await launchAndGetPayload()).not.toHaveProperty('target');
  });

  it('does not list worktrees or show the picker for a remote Project', async () => {
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-pr'));
    await Promise.resolve();
    expect(listWorktrees).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Squad target')).toBeNull();
  });
});
