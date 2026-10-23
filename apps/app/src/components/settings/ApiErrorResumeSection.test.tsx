// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { ApiErrorResumeSection } from './ApiErrorResumeSection';

const base = { version: 1, theme: 'system', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13, lastProjectId: null } as AppConfig;
const rule = (o: object = {}) => ({ id: 'a', match: 'overloaded', matchMode: 'contains', message: 'continue', delaySeconds: 20, enabled: true, ...o });
const on = (rules: object[] = [], extra: object = {}) =>
  ({ ...base, apiErrorResume: { enabled: true, rules, maxPerWindow: 3, windowMinutes: 15, ...extra } }) as AppConfig;
const THROW = { throwOnError: true };
const valueOf = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

function setup(config: AppConfig) {
  const onUpdate = vi.fn().mockResolvedValue(undefined);
  const onConfigDraft = vi.fn();
  render(<ApiErrorResumeSection config={config} onUpdate={onUpdate} onConfigDraft={onConfigDraft} />);
  return { onUpdate, onConfigDraft };
}

const check = vi.fn();
beforeEach(() => { (window as any).cc = { apiErrorResume: { check } }; check.mockReset(); });
afterEach(() => { cleanup(); delete (window as any).cc; });

describe('ApiErrorResumeSection', () => {
  it('toggle sends a whole object', () => {
    const { onUpdate } = setup(base);
    fireEvent.click(screen.getByRole('switch', { name: 'Resume after matching API errors' }));
    expect(onUpdate).toHaveBeenCalledWith({ apiErrorResume: { enabled: true, rules: [], maxPerWindow: 3, windowMinutes: 15 } }, THROW);
    expect(screen.queryByText('Add rule')).toBeNull();
  });

  it('a suggestion adds its rule and its button hides once present', () => {
    const { onUpdate } = setup(on());
    fireEvent.click(screen.getByText('+ Provider anthropic not found'));
    const sent = onUpdate.mock.calls[0][0].apiErrorResume;
    expect(sent.rules).toHaveLength(1);
    expect(sent.rules[0]).toMatchObject({ match: 'Provider anthropic not found', matchMode: 'contains', message: 'continue', delaySeconds: 20 });
    cleanup();
    setup(on([rule({ match: 'provider ANTHROPIC not found' })]));
    expect(screen.queryByText('+ Provider anthropic not found')).toBeNull();
    expect(screen.getByText('+ Connection lost mid-response')).toBeTruthy();
  });

  it('Add rule adds a local draft row that saves once it is valid', () => {
    const { onUpdate } = setup(on());
    fireEvent.click(screen.getByText('Add rule'));
    expect(onUpdate).not.toHaveBeenCalled();
    const input = screen.getByLabelText('When the error matches (rule 1)');
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.blur(input);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('At least 4 characters');
    fireEvent.change(input, { target: { value: 'rate limited' } });
    fireEvent.blur(input);
    expect(onUpdate.mock.calls[0][0].apiErrorResume.rules.map((r: any) => r.match)).toEqual(['rate limited']);
    expect(screen.queryByLabelText('When the error matches (rule 2)')).toBeNull();
  });

  // Mirrors SettingsView: onConfigDraft feeds back into config, onUpdate stores it.
  function Stateful({ initial, onUpdate }: { initial: AppConfig; onUpdate: (p: any) => void }) {
    const [cfg, setCfg] = useState(initial);
    return <ApiErrorResumeSection config={cfg} onConfigDraft={setCfg} onUpdate={(patch) => { onUpdate(patch); setCfg({ ...cfg, ...patch }); }} />;
  }

  it('a blank draft row can be removed and survives a suggestion click', () => {
    const onUpdate = vi.fn();
    render(<Stateful initial={on()} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByText('Add rule'));
    fireEvent.click(screen.getByText('+ Provider anthropic not found'));
    expect(onUpdate.mock.calls[0][0].apiErrorResume.rules).toHaveLength(1);
    expect(valueOf('When the error matches (rule 1)')).toBe('Provider anthropic not found');
    expect(valueOf('When the error matches (rule 2)')).toBe('');
    fireEvent.click(screen.getByLabelText('Remove rule 2'));
    expect(screen.queryByLabelText('When the error matches (rule 2)')).toBeNull();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('never persists a half-typed edit of a saved rule when something else saves', () => {
    const saved = rule({ id: 'a', matchMode: 'regex', match: 'Provider.*not found' });
    const other = rule({ id: 'b', match: 'second rule' });
    const onUpdate = vi.fn();
    render(<Stateful initial={on([saved, other])} onUpdate={onUpdate} />);
    const input = screen.getByLabelText('When the error matches (rule 1)');
    // a valid intermediate that would match everything, then an invalid one
    fireEvent.change(input, { target: { value: 'Provider.*not found|' } });
    fireEvent.change(input, { target: { value: 'Provider.*not found|(' } });
    fireEvent.blur(input);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Not a valid regular expression');
    fireEvent.click(screen.getByLabelText('Remove rule 2'));
    expect(onUpdate.mock.calls[0][0].apiErrorResume.rules).toEqual([saved]);
  });

  it('keeps a saved rule when the section remounts with an edit in progress', () => {
    const saved = rule({ id: 'a', match: 'first rule' });
    const other = rule({ id: 'b', match: 'second rule' });
    const onUpdate = vi.fn();
    const first = render(<Stateful initial={on([saved, other])} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByLabelText('When the error matches (rule 1)'), { target: { value: 'x' } });
    first.unmount();
    render(<Stateful initial={on([saved, other])} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText('Remove rule 2'));
    expect(onUpdate.mock.calls[0][0].apiErrorResume.rules).toEqual([saved]);
  });

  it('typing drafts and blur saves a valid rule', () => {
    const { onUpdate, onConfigDraft } = setup(on([rule()]));
    const input = screen.getByLabelText('When the error matches (rule 1)');
    fireEvent.change(input, { target: { value: 'rate limited' } });
    expect((input as HTMLInputElement).value).toBe('rate limited');
    expect(onConfigDraft).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Send (rule 1)'), { target: { value: 'go on' } });
    fireEvent.blur(screen.getByLabelText('Send (rule 1)'));
    expect(onUpdate.mock.calls[0][0].apiErrorResume.rules).toEqual([expect.objectContaining({ match: 'rate limited', message: 'go on' })]);
  });

  it('shows an alert and does not save an invalid regex or a short match', () => {
    const { onUpdate } = setup(on([rule({ matchMode: 'regex', match: '(oops' }), rule({ id: 'b', match: 'abc' })]));
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent);
    expect(alerts).toEqual(['Not a valid regular expression', 'At least 4 characters']);
    fireEvent.blur(screen.getByLabelText('When the error matches (rule 1)'));
    fireEvent.blur(screen.getByLabelText('When the error matches (rule 2)'));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('toggling the regex box saves when valid', () => {
    const { onUpdate } = setup(on([rule()]));
    fireEvent.click(screen.getByLabelText('Regex (rule 1)'));
    expect(onUpdate.mock.calls[0][0].apiErrorResume.rules[0].matchMode).toBe('regex');
  });

  it('removes a rule', () => {
    const { onUpdate } = setup(on([rule(), rule({ id: 'b', match: 'second rule' })]));
    fireEvent.click(screen.getByLabelText('Remove rule 1'));
    expect(onUpdate.mock.calls[0][0].apiErrorResume.rules.map((r: any) => r.id)).toEqual(['b']);
  });

  it('clamps the delay and the cap inputs', () => {
    const { onUpdate, onConfigDraft } = setup(on([rule()]));
    const delay = screen.getByLabelText('After (seconds) (rule 1)');
    fireEvent.change(delay, { target: { value: '30' } });
    expect((delay as HTMLInputElement).value).toBe('30');
    fireEvent.change(delay, { target: { value: '' } });
    fireEvent.blur(delay, { target: { value: '9999' } });
    expect(onUpdate.mock.calls[0][0].apiErrorResume.rules[0].delaySeconds).toBe(600);
    fireEvent.blur(delay, { target: { value: '1' } });
    expect(onUpdate.mock.calls[1][0].apiErrorResume.rules[0].delaySeconds).toBe(5);
    fireEvent.blur(delay, { target: { value: 'x' } });
    expect(onUpdate.mock.calls[2][0].apiErrorResume.rules[0].delaySeconds).toBe(20);

    const per = screen.getByLabelText('Messages before stopping');
    const mins = screen.getByLabelText('Minutes in the window');
    fireEvent.change(per, { target: { value: '5' } });
    fireEvent.change(mins, { target: { value: '30' } });
    fireEvent.change(per, { target: { value: '' } });
    fireEvent.change(mins, { target: { value: '' } });
    fireEvent.blur(per, { target: { value: '99' } });
    expect(onUpdate).toHaveBeenLastCalledWith({ apiErrorResume: expect.objectContaining({ maxPerWindow: 10 }) }, THROW);
    fireEvent.blur(mins, { target: { value: '1' } });
    expect(onUpdate).toHaveBeenLastCalledWith({ apiErrorResume: expect.objectContaining({ windowMinutes: 5 }) }, THROW);
    fireEvent.blur(per, { target: { value: 'x' } });
    expect(onUpdate).toHaveBeenLastCalledWith({ apiErrorResume: expect.objectContaining({ maxPerWindow: 3 }) }, THROW);
  });

  it('Check reports a match, no match and a skipped rule', async () => {
    setup(on([rule(), rule({ id: 'b', match: 'second rule', matchMode: 'regex' })]));
    fireEvent.change(screen.getByLabelText('Error text to check'), { target: { value: 'Overloaded' } });
    check.mockResolvedValueOnce({ ruleId: 'b', message: 'go', delaySeconds: 7, skipped: [] });
    fireEvent.click(screen.getByText('Check'));
    await screen.findByText('Matches rule 2: Zana would send “go” after 7 s.');
    expect(check).toHaveBeenCalledWith({ text: 'Overloaded', rules: expect.any(Array) });
    check.mockResolvedValueOnce({ ruleId: 'a', skipped: [] });
    fireEvent.click(screen.getByText('Check'));
    await screen.findByText('Matches rule 1: Zana would send “continue” after 20 s.');
    check.mockResolvedValueOnce({ ruleId: null, skipped: [] });
    fireEvent.click(screen.getByText('Check'));
    await screen.findByText('No rule matches. Zana would leave the agent waiting for you.');
    check.mockResolvedValueOnce({ ruleId: null, skipped: [{ ruleId: 'b', reason: 'timeout' }, { ruleId: 'a', reason: 'unavailable' }] });
    fireEvent.click(screen.getByText('Check'));
    await screen.findByText('Rule 2 took too long to check and was skipped. Rule 1 could not be checked right now. Try again.');
  });

  it('numbers the matching rule by its row even when an earlier row is invalid', async () => {
    setup(on([rule({ id: 'bad', match: 'ab' }), rule({ id: 'good', match: 'second rule' })]));
    check.mockResolvedValueOnce({ ruleId: 'good', message: 'continue', delaySeconds: 20, skipped: [] });
    fireEvent.click(screen.getByText('Check'));
    await screen.findByText(/Matches rule 2:/);
  });

  it('ignores an older Check answer that arrives after a newer one', async () => {
    setup(on([rule()]));
    let first!: (v: unknown) => void;
    check.mockImplementationOnce(() => new Promise((r) => { first = r; }));
    check.mockResolvedValueOnce({ ruleId: null, skipped: [] });
    fireEvent.click(screen.getByText('Check'));
    fireEvent.click(screen.getByText('Check'));
    await screen.findByText('No rule matches. Zana would leave the agent waiting for you.');
    first({ ruleId: 'a', message: 'continue', delaySeconds: 20, skipped: [] });
    await Promise.resolve();
    expect(screen.queryByText(/Matches rule/)).toBeNull();
  });

  it('keeps a new rule and shows an alert when its save fails, then saves it on retry', async () => {
    const { onUpdate } = setup(on());
    onUpdate.mockRejectedValueOnce(new Error('disk full'));
    fireEvent.click(screen.getByText('Add rule'));
    const input = screen.getByLabelText('When the error matches (rule 1)');
    fireEvent.change(input, { target: { value: 'rate limited' } });
    fireEvent.blur(input);
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't save the last change. What you typed is still here, so try again.");
    expect((screen.getByLabelText('When the error matches (rule 1)') as HTMLInputElement).value).toBe('rate limited');
    fireEvent.blur(screen.getByLabelText('When the error matches (rule 1)'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it('keeps an edit of a saved rule when its save fails, and drops it once stored', async () => {
    const onUpdate = vi.fn();
    onUpdate.mockRejectedValueOnce(new Error('nope'));
    function Store({ initial }: { initial: AppConfig }) {
      const [cfg, setCfg] = useState(initial);
      return <ApiErrorResumeSection config={cfg} onConfigDraft={setCfg} onUpdate={async (patch) => { await onUpdate(patch); setCfg({ ...cfg, ...patch }); }} />;
    }
    render(<Store initial={on([rule()])} />);
    const input = screen.getByLabelText('When the error matches (rule 1)');
    fireEvent.change(input, { target: { value: 'rate limited' } });
    fireEvent.blur(input);
    await screen.findByRole('alert');
    expect((screen.getByLabelText('When the error matches (rule 1)') as HTMLInputElement).value).toBe('rate limited');
    fireEvent.blur(screen.getByLabelText('When the error matches (rule 1)'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(onUpdate).toHaveBeenLastCalledWith({ apiErrorResume: expect.objectContaining({ rules: [expect.objectContaining({ match: 'rate limited' })] }) });
    expect((screen.getByLabelText('When the error matches (rule 1)') as HTMLInputElement).value).toBe('rate limited');
  });

  // Saves land only when the test says so; the config then updates like SettingsView's.
  function Deferred({ initial, swallow = false }: { initial: AppConfig; swallow?: boolean }) {
    const [cfg, setCfg] = useState(initial);
    return (
      <ApiErrorResumeSection
        config={cfg}
        onConfigDraft={setCfg}
        onUpdate={(patch) => new Promise<void>((resolve) => {
          landing.push(() => { if (!swallow) setCfg((c) => ({ ...c, ...patch })); resolve(); });
        })}
      />
    );
  }
  let landing: (() => void)[] = [];
  const land = async () => { await act(async () => { landing.shift()!(); }); };
  beforeEach(() => { landing = []; });

  it('a newer edit typed while the save of a saved rule is in flight is not wiped when it lands', async () => {
    render(<Deferred initial={on([rule()])} />);
    const input = screen.getByLabelText('When the error matches (rule 1)');
    fireEvent.change(input, { target: { value: 'rate limited' } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: 'rate limited again' } });
    await land();
    expect(valueOf('When the error matches (rule 1)')).toBe('rate limited again');
  });

  it('a new row keeps typing done while its first save is in flight', async () => {
    render(<Deferred initial={on()} />);
    fireEvent.click(screen.getByText('Add rule'));
    const input = screen.getByLabelText('When the error matches (rule 1)');
    fireEvent.change(input, { target: { value: 'rate limited' } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: 'rate limited again' } });
    await land();
    expect(valueOf('When the error matches (rule 1)')).toBe('rate limited again');
    expect(screen.queryByLabelText('When the error matches (rule 2)')).toBeNull();
  });

  it('removing a new row while its first save is in flight removes the stored rule too', async () => {
    render(<Deferred initial={on()} />);
    fireEvent.click(screen.getByText('+ Provider anthropic not found'));
    fireEvent.click(screen.getByLabelText('Remove rule 1'));
    expect(screen.queryByLabelText('When the error matches (rule 1)')).toBeNull();
    await land();
    await land();
    expect(screen.queryByLabelText('When the error matches (rule 1)')).toBeNull();
    expect(screen.getByText('+ Provider anthropic not found')).toBeTruthy();
  });

  it('two quick suggestion clicks both land', async () => {
    render(<Deferred initial={on()} />);
    fireEvent.click(screen.getByText('+ Provider anthropic not found'));
    fireEvent.click(screen.getByText('+ Connection lost mid-response'));
    await land();
    await land();
    expect(valueOf('When the error matches (rule 1)')).toBe('Provider anthropic not found');
    expect(valueOf('When the error matches (rule 2)')).toBe('Connection lost mid-response');
  });

  it('keeps typed rules when the save resolves without storing them (a swallowed failure)', async () => {
    render(<Deferred initial={on([rule()])} swallow />);
    const input = screen.getByLabelText('When the error matches (rule 1)');
    fireEvent.change(input, { target: { value: 'rate limited' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByText('Add rule'));
    const added = screen.getByLabelText('When the error matches (rule 2)');
    fireEvent.change(added, { target: { value: 'second error' } });
    fireEvent.blur(added);
    await land();
    await land();
    expect(valueOf('When the error matches (rule 1)')).toBe('rate limited');
    expect(valueOf('When the error matches (rule 2)')).toBe('second error');
  });

  it('a failed toggle, cap or remove shows the save alert instead of an unhandled rejection', async () => {
    const { onUpdate } = setup(on([rule()]));
    onUpdate.mockRejectedValue(new Error('nope'));
    fireEvent.click(screen.getByLabelText('Remove rule 1'));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('When the error matches (rule 1)')).toBeTruthy();
    fireEvent.blur(screen.getByLabelText('Messages before stopping'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Resume after matching API errors' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('a blur with nothing changed saves nothing', () => {
    const { onUpdate } = setup(on([rule()]));
    fireEvent.blur(screen.getByLabelText('When the error matches (rule 1)'));
    fireEvent.blur(screen.getByLabelText('Send (rule 1)'));
    fireEvent.blur(screen.getByLabelText('After (seconds) (rule 1)'), { target: { value: '20' } });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('an older save failing after a newer one landed shows no alert', async () => {
    let failFirst!: () => void;
    const onUpdate = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((_r, reject) => { failFirst = () => reject(new Error('late')); }))
      .mockResolvedValueOnce(undefined);
    render(<ApiErrorResumeSection config={on()} onConfigDraft={vi.fn()} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByText('+ Provider anthropic not found'));
    fireEvent.click(screen.getByText('+ Connection lost mid-response'));
    expect(onUpdate.mock.calls[1][0].apiErrorResume.rules).toHaveLength(2);
    await act(async () => { failFirst(); });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('flags a match the store would drop: too long, or the same as another row', () => {
    const { onUpdate } = setup(on([rule(), rule({ id: 'b', match: 'second rule' }), rule({ id: 'c', matchMode: 'regex', match: 'Over.*' })]));
    const second = screen.getByLabelText('When the error matches (rule 2)');
    fireEvent.change(second, { target: { value: '  OVERLOADED ' } });
    fireEvent.blur(second);
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(['Same as rule 2', 'Same as rule 1']);
    fireEvent.change(second, { target: { value: 'x'.repeat(301) } });
    fireEvent.blur(second);
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(['At most 300 characters']);
    // the same text as a regex is a different rule
    fireEvent.change(second, { target: { value: 'Over.*' } });
    fireEvent.click(screen.getByLabelText('Regex (rule 2)'));
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(['Same as rule 3', 'Same as rule 2']);
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Regex (rule 2)'));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('caps the message length and stops adding rules at the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => rule({ id: `r${i}`, match: `error number ${i}` }));
    setup(on(many));
    expect(screen.getByLabelText('Send (rule 1)').getAttribute('maxlength')).toBe('200');
    expect((screen.getByText('Add rule') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('+ Provider anthropic not found') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('You can have up to 20 rules.')).toBeTruthy();
  });

  it('Check shows a failure, not the previous answer, when the request rejects', async () => {
    setup(on([rule()]));
    check.mockResolvedValueOnce({ ruleId: 'a', message: 'continue', delaySeconds: 20, skipped: [] });
    fireEvent.click(screen.getByText('Check'));
    await screen.findByText(/Matches rule 1/);
    check.mockRejectedValueOnce(new Error('ipc down'));
    fireEvent.click(screen.getByText('Check'));
    await screen.findByText("Zana couldn't check the error just now. Try again.");
    expect(screen.queryByText(/Matches rule 1/)).toBeNull();
  });

  it('ignores an older Check failure that arrives after a newer answer', async () => {
    setup(on([rule()]));
    let fail!: (e: Error) => void;
    check.mockImplementationOnce(() => new Promise((_r, reject) => { fail = reject; }));
    check.mockResolvedValueOnce({ ruleId: null, skipped: [] });
    fireEvent.click(screen.getByText('Check'));
    fireEvent.click(screen.getByText('Check'));
    await screen.findByText('No rule matches. Zana would leave the agent waiting for you.');
    await act(async () => { fail(new Error('late')); });
    expect(screen.queryByText(/couldn't check/)).toBeNull();
    expect(screen.getByText('No rule matches. Zana would leave the agent waiting for you.')).toBeTruthy();
  });

  it('Check says it is desktop-only when the API is missing', async () => {
    delete (window as any).cc;
    setup(on());
    fireEvent.click(screen.getByText('Check'));
    await waitFor(() => expect(screen.getByText('Check is only available in the desktop app.')).toBeTruthy());
  });
});
