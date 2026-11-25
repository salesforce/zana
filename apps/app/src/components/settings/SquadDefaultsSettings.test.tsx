// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { SquadDefaultsSettings, squadDefaultsSummary } from './SquadDefaultsSettings';

afterEach(cleanup);

const base: AppConfig = { version: 1, theme: 'system', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13, lastProjectId: null };

describe('squadDefaultsSummary', () => {
  it('reads a missing value as Follow caller and names each choice', () => {
    expect(squadDefaultsSummary(base)).toBe('Launch mode: Follow caller');
    expect(squadDefaultsSummary({ ...base, squadDefaultTransport: 'follow' })).toBe('Launch mode: Default launch mode');
    expect(squadDefaultsSummary({ ...base, squadDefaultTransport: 'MODERN' })).toBe('Launch mode: Modern');
    expect(squadDefaultsSummary({ ...base, squadDefaultTransport: 'CLI' })).toBe('Launch mode: CLI Agent');
  });
});

describe('SquadDefaultsSettings', () => {
  it('is visible, not collapsed, and shows the state in its heading', () => {
    render(<SquadDefaultsSettings config={base} onUpdate={vi.fn()} />);
    expect(screen.getByTestId('squads-defaults')).toBeTruthy();
    expect(screen.getByTestId('squads-defaults-summary').textContent).toBe('Launch mode: Follow caller');
    expect(screen.getByLabelText('All Squads launch mode')).toBeTruthy();
  });

  it('writes the chosen global launch mode through the draft and update callbacks', () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const onConfigDraft = vi.fn();
    render(<SquadDefaultsSettings config={base} onConfigDraft={onConfigDraft} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText('All Squads launch mode'));
    fireEvent.click(screen.getByRole('option', { name: /^Modern/ }));
    expect(onUpdate).toHaveBeenCalledWith({ squadDefaultTransport: 'MODERN' });
    expect(onConfigDraft).toHaveBeenCalledWith({ ...base, squadDefaultTransport: 'MODERN' });
  });
});
