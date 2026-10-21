/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { USED_BY_LIMITS, UsedByAgents } from './UsedByAgents.js';

afterEach(cleanup);

const names = ['Help', 'Orders', 'Returns', 'Billing', 'Cases', 'Leads', 'Quotes', 'Sales', 'Service', 'Support'];
const many = [...names.map(name => `bots/${name}.agent`), ...[26, 27, 28, 29].map(n => `bots/Voice_${n}.agent`)];
const row = (usedBy: string[], onOpenAgent = vi.fn()) => render(<dl><UsedByAgents usedBy={usedBy} onOpenAgent={onOpenAgent} /></dl>);

describe('UsedByAgents', () => {
  it('shows a short list in full, without a filter, even when a series holds many agents', () => {
    row(['bots/Help.agent', ...Array.from({ length: 14 }, (_, n) => `bots/Voice_${n + 26}.agent`)]);
    expect(screen.getByText('15')).toBeTruthy();
    expect(screen.queryByLabelText('Filter agents')).toBeNull();
    expect(screen.queryByText(/more$/)).toBeNull();
  });

  it('caps the chips with "+N more" and folds back with "Show less"', () => {
    row(many);
    expect(screen.getAllByRole('button').filter(b => b.classList.contains('is-more') === false)).toHaveLength(USED_BY_LIMITS.chips);
    fireEvent.click(screen.getByRole('button', { name: '+6 more' }));
    expect(screen.getByRole('button', { name: 'Voice_26 to 29, 4 agents' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(screen.getByRole('button', { name: '+6 more' })).toBeTruthy();
  });

  it('filters by agent name, ignoring the .agent extension, and opens a match', () => {
    const onOpenAgent = vi.fn();
    row(many, onOpenAgent);
    const input = screen.getByLabelText('Filter agents');
    fireEvent.change(input, { target: { value: 'agent' } });
    expect(screen.getByText('No matching agents.')).toBeTruthy();
    expect(screen.getByText('0 of 14')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'voice' } });
    expect(screen.queryByText(/more$/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Voice_26 to 29, 4 agents' }));
    expect(screen.getByRole('group', { name: 'Voice_ agents' }).textContent).toBe('Voice_…26272829');
    fireEvent.click(screen.getByRole('button', { name: 'Voice_28' }));
    expect(onOpenAgent).toHaveBeenCalledWith('bots/Voice_28.agent');
    fireEvent.change(input, { target: { value: 'sup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Support' }));
    expect(onOpenAgent).toHaveBeenLastCalledWith('bots/Support.agent');
    expect(screen.queryByRole('group')).toBeNull();
  });
});
