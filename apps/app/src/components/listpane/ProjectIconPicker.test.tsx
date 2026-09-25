/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PROJECT_ICONS } from '@zana-ai/zcc-domain';
import { ProjectIconPicker } from './ProjectIconPicker.js';

vi.mock('../../lib/resolveIcon.js', () => ({ resolveIcon: () => () => <svg /> }));
afterEach(cleanup);
describe('ProjectIconPicker', () => {
  it('exposes labelled choices, defaults to Circle, and reports each selection', () => {
    const onChange = vi.fn();
    render(<ProjectIconPicker onChange={onChange} />);
    expect(screen.getByRole('group', { name: 'Project icon' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use Circle icon' }).getAttribute('aria-pressed')).toBe('true');
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(PROJECT_ICONS.length);
    buttons.forEach(button => fireEvent.click(button));
    expect(onChange.mock.calls.map(([icon]) => icon)).toEqual(PROJECT_ICONS);
  });
  it('marks the persisted choice as selected', () => {
    render(<ProjectIconPicker value="Cloud" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Use Cloud icon' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Use Circle icon' }).getAttribute('aria-pressed')).toBe('false');
  });
});
