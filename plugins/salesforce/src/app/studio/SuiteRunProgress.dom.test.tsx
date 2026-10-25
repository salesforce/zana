/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { SuiteRunProgress } from './SuiteRunProgress.js';
import type { SuiteProgress } from '../../../lib/studio-contract.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });
const cases = [{ id: 'c', name: 'Refund request', utterances: ['hi'], expect: {} }];
const progress: SuiteProgress = { id: 'r', mode: 'simulate', startedAt: 1000, caseIds: ['c'], completed: 0, currentCaseId: 'c', stage: 'starting', results: {} };

it('identifies the source currently being compared', () => {
  const view = render(<SuiteRunProgress cases={cases} progress={{ ...progress, mode: 'compare', comparisonPhase: 'reference' }} startedAt={0} />);
  expect(screen.getByRole('status').textContent).toContain('Compare saved source · 0 of 1');
  view.rerender(<SuiteRunProgress cases={cases} progress={{ ...progress, mode: 'compare', comparisonPhase: 'candidate' }} startedAt={0} />);
  expect(screen.getByRole('status').textContent).toContain('Compare editor draft · 0 of 1');
});

it('shows real case counts and stage changes including a multi-turn conversation', () => {
  const view = render(<SuiteRunProgress cases={cases} progress={progress} startedAt={0} />);
  expect(screen.getByRole('status').textContent).toContain('Simulate · 0 of 1 cases complete');
  expect(screen.getByText('Refund request')).toBeTruthy();
  expect(screen.getByRole('progressbar').getAttribute('value')).toBe('0');
  for (const [stage, label] of [['conversation', 'Waiting for agent response · turn 2 of 8'], ['trace', 'Checking topics and actions'], ['judging', 'Evaluating criteria'], ['saving', 'Finishing run']] as const) {
    view.rerender(<SuiteRunProgress cases={cases} progress={{ ...progress, stage, turn: 2, totalTurns: 8 }} startedAt={0} />);
    expect(screen.getByText(label)).toBeTruthy();
  }
  view.rerender(<SuiteRunProgress cases={cases} progress={{ ...progress, mode: 'proposal', completed: 1 }} startedAt={0} />);
  expect(screen.getByRole('status').textContent).toContain('Proposal · 1 of 1 cases complete');
  expect(screen.getByRole('progressbar').getAttribute('value')).toBe('1');
});

it('shows elapsed time while waiting and clears its timer on unmount', () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const view = render(<SuiteRunProgress cases={cases} startedAt={1000} />);
  expect(screen.getByText('Starting run')).toBeTruthy();
  expect(screen.getByTestId('tests-run-elapsed').textContent).toBe('Elapsed 0s');
  act(() => { vi.advanceTimersByTime(65_000); });
  expect(screen.getByTestId('tests-run-elapsed').textContent).toBe('Elapsed 1m 5s');
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps org evaluation indeterminate until Salesforce supplies results', () => {
  const view = render(<SuiteRunProgress cases={cases} progress={{ ...progress, mode: 'org-eval', stage: 'org-eval', currentCaseId: undefined }} startedAt={0} />);
  expect(screen.getByRole('status').textContent).toContain('Org eval · Running');
  expect(screen.getByText('Waiting for Salesforce evaluation results')).toBeTruthy();
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByText('Case results appear when Salesforce finishes.')).toBeTruthy();
  view.rerender(<SuiteRunProgress cases={[]} orgEval startedAt={Date.now() + 1000} />);
  expect(screen.getByTestId('tests-run-elapsed').textContent).toBe('Elapsed 0s');
});
