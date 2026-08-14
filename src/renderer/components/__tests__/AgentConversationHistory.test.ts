import { describe, expect, it } from 'vitest';
import type { ConversationHistorySnapshot } from '@shared/types';
import { historySnapshotForDisplay } from '../AgentConversationHistory.js';

const row = {
  historyId: 'opaque-row', source: 'claude' as const, title: 'Keep this conversation',
  lastActiveAt: 1, projectName: 'Project', fidelity: 'exact-native-id' as const,
  availability: 'available' as const
};

const snapshot = (overrides: Partial<ConversationHistorySnapshot> = {}): ConversationHistorySnapshot => ({
  snapshotId: 'snapshot', status: 'ready', rows: [row], coverage: [], hasNextPage: false, ...overrides
});

describe('historySnapshotForDisplay', () => {
  it('keeps rows clickable while refresh starts and readers are still provisional', () => {
    const current = snapshot();
    const provisional = snapshot({ snapshotId: 'refresh', status: 'provisional', rows: [] });
    expect(historySnapshotForDisplay(current, provisional, true)).toBe(current);
  });

  it('replaces prior rows as soon as refreshed results arrive', () => {
    const current = snapshot();
    const refreshed = snapshot({ snapshotId: 'refresh', rows: [{ ...row, historyId: 'new-row', title: 'New conversation' }] });
    expect(historySnapshotForDisplay(current, refreshed, true)).toBe(refreshed);
  });

  it('keeps prior rows when refresh completes empty', () => {
    const current = snapshot();
    const empty = snapshot({ snapshotId: 'refresh', status: 'ready', rows: [] });
    expect(historySnapshotForDisplay(current, empty, true)).toBe(current);
  });

  it('shows an empty initial load because no previous choices exist', () => {
    const empty = snapshot({ rows: [] });
    expect(historySnapshotForDisplay(snapshot({ rows: [] }), empty, false)).toBe(empty);
  });
});
