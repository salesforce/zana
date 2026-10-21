/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionBoardSnapshot } from '@zana-ai/zcc-domain/product';
import { ExecutionJobDetails } from './ExecutionJobDetails.js';

function snapshot(startedFrom?: { kind: 'pty' | 'thread'; id: string; title?: string }): ExecutionBoardSnapshot {
  return {
    execution: {
      executionId: 'execution-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Ship', state: 'RUNNING', attempt: 1,
      stateVersion: 2, createdAt: 1, updatedAt: 2, sources: [], blockers: [], recoveryAttention: false,
      ...(startedFrom ? { startedFrom } : {})
    },
    events: [], nextAfter: 0, truncated: false, artifacts: [], artifactsTruncated: false
  } as unknown as ExecutionBoardSnapshot;
}

function mount(value: ExecutionBoardSnapshot) {
  Object.defineProperty(window, 'cc', { configurable: true, value: {
    executionBoard: { snapshot: vi.fn(async () => value) }, clipboard: { writeText: vi.fn() }
  } });
  render(<ExecutionJobDetails projectId="project-1" executionId="execution-1" onClose={() => {}} />);
}

describe('ExecutionJobDetails Started from', () => {
  afterEach(cleanup);

  it('shows the conversation title', async () => {
    mount(snapshot({ kind: 'thread', id: 't', title: 'Design chat' }));
    await screen.findByText('Started from');
    expect(screen.getByText('Design chat')).toBeTruthy();
  });

  it.each([
    ['thread', 'A Modern conversation'],
    ['pty', 'A CLI Agent session']
  ] as const)('falls back for an untitled %s', async (kind, text) => {
    mount(snapshot({ kind, id: 'x' }));
    await screen.findByText('Started from');
    expect(screen.getByText(text)).toBeTruthy();
  });

  it('omits the row when the run was not started from a session', async () => {
    mount(snapshot());
    await screen.findByText('Run ID');
    expect(screen.queryByText('Started from')).toBeNull();
  });
});
