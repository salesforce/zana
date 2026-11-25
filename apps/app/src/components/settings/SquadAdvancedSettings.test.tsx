// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { RevealContext } from '@/lib/settings-search/reveal';
import { SquadAdvancedSettings, squadAdvancedSummary } from './SquadAdvancedSettings';

afterEach(cleanup);

const base: AppConfig = { version: 1, theme: 'system', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13, lastProjectId: null };

describe('squadAdvancedSummary', () => {
  it('reports default, custom and off states', () => {
    expect(squadAdvancedSummary(base)).toBe('Reminder 30 min · Checkpoints on');
    expect(squadAdvancedSummary({ ...base, executionBlockerReminderMs: 900_000, squadUnitCheckpointsEnabled: false })).toBe('Reminder 15 min · Checkpoints off');
    expect(squadAdvancedSummary({ ...base, executionBlockerReminderMs: 0 })).toBe('Reminder off · Checkpoints on');
  });
});

describe('SquadAdvancedSettings', () => {
  it('is collapsed by default and shows the state in its summary', () => {
    render(<SquadAdvancedSettings config={base} onUpdate={vi.fn()} />);
    const details = screen.getByTestId('squads-advanced') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(screen.getByTestId('squads-advanced-summary').textContent).toBe('Reminder 30 min · Checkpoints on');
  });

  it('toggles checkpoints through the draft and update callbacks', () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const onConfigDraft = vi.fn();
    render(<SquadAdvancedSettings config={base} onConfigDraft={onConfigDraft} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Checkpoint each unit' }));
    expect(onUpdate).toHaveBeenCalledWith({ squadUnitCheckpointsEnabled: false });
    expect(onConfigDraft).toHaveBeenCalledWith({ ...base, squadUnitCheckpointsEnabled: false });
  });

  it('expands when a settings-search result targets a Squads row', () => {
    render(
      <RevealContext.Provider value={{ target: 'squads.unit-checkpoints', reveal: 'advanced' }}>
        <SquadAdvancedSettings config={base} onUpdate={vi.fn()} />
      </RevealContext.Provider>
    );
    expect((screen.getByTestId('squads-advanced') as HTMLDetailsElement).open).toBe(true);
  });

  it('stays collapsed for a reveal aimed at another page', () => {
    render(
      <RevealContext.Provider value={{ target: 'editor.code-app', reveal: 'advanced' }}>
        <SquadAdvancedSettings config={base} onUpdate={vi.fn()} />
      </RevealContext.Provider>
    );
    expect((screen.getByTestId('squads-advanced') as HTMLDetailsElement).open).toBe(false);
  });
});
