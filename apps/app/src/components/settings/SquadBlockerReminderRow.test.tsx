// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { SquadBlockerReminderRow, parseBlockerReminderMinutes } from './SquadBlockerReminderRow';

afterEach(cleanup);

const base: AppConfig = { version: 1, theme: 'system', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13, lastProjectId: null };

function setup(ms?: number) {
  const onUpdate = vi.fn().mockResolvedValue(undefined);
  const config = ms === undefined ? base : { ...base, executionBlockerReminderMs: ms };
  const view = render(<SquadBlockerReminderRow config={config} onUpdate={onUpdate} />);
  const input = screen.getByRole('textbox') as HTMLInputElement;
  return { onUpdate, input, view, config };
}

describe('parseBlockerReminderMinutes', () => {
  it('maps blank to the default, 0 to off, and whole minutes to ms', () => {
    expect(parseBlockerReminderMinutes('  ')).toEqual({ ok: true, ms: 1_800_000 });
    expect(parseBlockerReminderMinutes('0')).toEqual({ ok: true, ms: 0 });
    expect(parseBlockerReminderMinutes('45')).toEqual({ ok: true, ms: 2_700_000 });
    expect(parseBlockerReminderMinutes('1440')).toEqual({ ok: true, ms: 86_400_000 });
  });
  it('rejects non-numbers and out-of-range values', () => {
    for (const bad of ['abc', '-5', '1.5', '1441', '1e3']) expect(parseBlockerReminderMinutes(bad).ok).toBe(false);
  });
});

describe('SquadBlockerReminderRow', () => {
  it('shows the saved window in minutes and the default as placeholder when unset', () => {
    expect(setup(900_000).input.value).toBe('15');
    cleanup();
    const unset = setup();
    expect(unset.input.value).toBe('');
    expect(unset.input.placeholder).toBe('30');
    cleanup();
    expect(setup(0).input.value).toBe('0');
  });

  it('saves minutes as ms on blur and on Enter', () => {
    const { input, onUpdate } = setup(900_000);
    fireEvent.change(input, { target: { value: '60' } });
    fireEvent.blur(input);
    expect(onUpdate).toHaveBeenCalledWith({ executionBlockerReminderMs: 3_600_000 }, { throwOnError: true });
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onUpdate).toHaveBeenLastCalledWith({ executionBlockerReminderMs: 0 }, { throwOnError: true });
  });

  it('blank saves the default; unchanged value saves nothing', () => {
    const { input, onUpdate } = setup(900_000);
    fireEvent.blur(input);
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onUpdate).toHaveBeenCalledWith({ executionBlockerReminderMs: 1_800_000 }, { throwOnError: true });
  });

  it('does not persist the default when an unset field is only focused and blurred, nor a rounded stored value', () => {
    const unset = setup();
    fireEvent.blur(unset.input);
    expect(unset.onUpdate).not.toHaveBeenCalled();
    cleanup();
    const odd = setup(90_000);
    fireEvent.blur(odd.input);
    expect(odd.onUpdate).not.toHaveBeenCalled();
  });

  it('shows a save error when the update rejects or throws', async () => {
    const { input, onUpdate } = setup(900_000);
    onUpdate.mockRejectedValueOnce(new Error('disk'));
    fireEvent.change(input, { target: { value: '60' } });
    fireEvent.blur(input);
    expect((await screen.findByRole('alert')).textContent).toContain('Could not save');
    onUpdate.mockImplementationOnce(() => { throw new Error('sync'); });
    fireEvent.change(input, { target: { value: '45' } });
    fireEvent.blur(input);
    expect((await screen.findByRole('alert')).textContent).toContain('Could not save');
  });

  it('shows an inline error and saves nothing for an invalid value, clearing it on edit', () => {
    const { input, onUpdate } = setup(900_000);
    fireEvent.change(input, { target: { value: '5000' } });
    fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toContain('1 to 1440');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '5' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('follows a config change from elsewhere', () => {
    const { view, onUpdate } = setup(900_000);
    view.rerender(<SquadBlockerReminderRow config={{ ...base, executionBlockerReminderMs: 120_000 }} onUpdate={onUpdate} />);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('2');
  });
});
