// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UsageSummary } from '@zana-ai/zcc-domain/telemetry-events';

const mocks = vi.hoisted(() => ({
  getMemoCounters: vi.fn(),
  refresh: vi.fn(),
  state: {
    summary: undefined as UsageSummary | undefined,
    loading: false,
    loaded: true,
    refresh: undefined as ReturnType<typeof vi.fn>
  }
}));

mocks.state.refresh = mocks.refresh;

vi.mock('../../lib/product-client.js', () => ({
  product: { usage: { getMemoCounters: mocks.getMemoCounters } }
}));

vi.mock('@/store', () => ({
  useUsage: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}));

import { UsageView } from './UsageView.js';

afterEach(() => {
  cleanup();
  mocks.getMemoCounters.mockReset();
  mocks.refresh.mockReset();
  mocks.state.summary = undefined;
  mocks.state.loading = false;
  mocks.state.loaded = true;
  mocks.refresh.mockResolvedValue(undefined);
});

const summary: UsageSummary = {
  generatedAt: 0,
  sessionCount: 2,
  totalTokens: 1_500,
  totalPromptCount: 3,
  totalToolCalls: 4,
  totalMcpCalls: 5,
  byProject: [{ kind: 'usage.rollup', dimension: 'project', label: 'Desktop', totalTokens: 1_000, promptCount: 2, toolCalls: 3, mcpCalls: 4, sessionCount: 1 }],
  byModel: [{ kind: 'usage.rollup', dimension: 'model', label: 'claude-sonnet-4-5-20250929', totalTokens: 500, promptCount: 1, toolCalls: 1, mcpCalls: 1, sessionCount: 1 }],
  topSessions: [{ kind: 'usage.session', sessionId: 'session-1', projectId: 'project-1', projectName: 'Desktop', persona: 'Builder', model: 'claude-sonnet-4-5-20250929', totalTokens: 1_000, promptCount: 2, toolCalls: 3, mcpCalls: 4, durationMs: 60_000 }]
};

describe('UsageView memo counters', () => {
  it('fetches and renders memo counters with usage summary on mount', async () => {
    mocks.state.summary = summary;
    mocks.getMemoCounters.mockResolvedValue({
      inference: { requests: 8, hits: 6, misses: 2, inFlightJoins: 1, activeLimitSkips: 0, evictions: 0, providerCalls: 2, failures: 0 }
    });

    render(<UsageView />);

    await waitFor(() => expect(screen.getByRole('region', { name: 'Inference memo' })).toBeTruthy());
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.getMemoCounters).toHaveBeenCalledTimes(1);
    const memo = screen.getByRole('region', { name: 'Inference memo' });
    expect(memo.textContent).toContain('inference');
    expect(memo.textContent).toContain('6');
    expect(memo.textContent).toContain('2');
    expect(screen.getByRole('region', { name: 'Top sessions' }).textContent).toContain('Builder');
  });

  it('clears failed memo counters and refetches them from refresh', async () => {
    mocks.state.summary = { ...summary, sessionCount: 0, byProject: [], byModel: [], topSessions: [] };
    mocks.getMemoCounters
      .mockRejectedValueOnce(new Error('memo unavailable'))
      .mockResolvedValueOnce({
        inference: { requests: 1, hits: 1, misses: 0, inFlightJoins: 0, activeLimitSkips: 0, evictions: 0, providerCalls: 0, failures: 0 }
      });

    render(<UsageView />);

    await waitFor(() => expect(mocks.getMemoCounters).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('region', { name: 'Inference memo' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh usage' }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Inference memo' })).toBeTruthy());
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    expect(screen.getByText('No usage yet')).toBeTruthy();
  });

  it('renders empty rollups and sessions without optional activity values', async () => {
    mocks.state.summary = {
      ...summary,
      generatedAt: 1,
      byProject: [],
      byModel: [{ kind: 'usage.rollup', dimension: 'model', label: 'unknown', totalTokens: 0, promptCount: 0, toolCalls: 0, mcpCalls: 0, sessionCount: 2 }],
      topSessions: [{ kind: 'usage.session', sessionId: 'session-2', projectId: 'project-2', projectName: 'Empty' }]
    };
    mocks.getMemoCounters.mockResolvedValue({});

    render(<UsageView />);

    await waitFor(() => expect(screen.getByText('Nothing to show.')).toBeTruthy());
    expect(screen.getByRole('region', { name: 'By model' }).textContent).toContain('0 prompts');
    expect(screen.getByRole('region', { name: 'Top sessions' }).textContent).toContain('—');
    expect(screen.getByText(/Generated/)).toBeTruthy();
  });

  it('disables refresh while summary refresh is in progress', async () => {
    mocks.state.loading = true;
    mocks.state.loaded = false;
    mocks.getMemoCounters.mockResolvedValue({});

    render(<UsageView />);

    expect(screen.queryByRole('region', { name: 'Totals' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Refresh usage' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Refreshing…')).toBeTruthy();
  });
});
