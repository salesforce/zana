/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GitStatus } from '@zana-ai/zcc-domain/product';

vi.mock('./DiffViewer.js', () => ({
  DiffViewer: () => <div data-testid="diff-viewer" />
}));

vi.mock('../lib/product-client.js', () => ({
  product: {
    git: {
      status: vi.fn(async () => ({
        branch: 'release/2.1.2',
        files: {
          '/repo/apps/app/src/a.ts': 'M',
          '/repo/apps/app/src/nested/b.ts': 'A'
        },
        dirty: true
      } satisfies Partial<GitStatus>)),
      showHead: vi.fn(async () => ({ ok: true, content: 'old', binary: false, notInHead: false }))
    },
    fs: {
      readFile: vi.fn(async () => ({ ok: true, content: 'new', binary: false }))
    }
  }
}));

import {
  AgentDiffPanel,
  agentDiffFileListModeLabel,
  agentDiffFileName,
  agentDiffParentDir,
  agentDiffUsesInlinePreview,
  nextAgentDiffFileListMode
} from './AgentDiffPanel.js';

describe('AgentDiffPanel file list mode', () => {
  afterEach(() => {
    cleanup();
  });

  it('toggles labels and confines helper paths', () => {
    expect(nextAgentDiffFileListMode('tree')).toBe('list');
    expect(nextAgentDiffFileListMode('list')).toBe('tree');
    expect(agentDiffFileListModeLabel('tree')).toBe('View as list');
    expect(agentDiffFileListModeLabel('list')).toBe('View as tree');
    expect(agentDiffFileName('/repo/apps/a.ts')).toBe('a.ts');
    expect(agentDiffParentDir('/repo/apps/a.ts')).toBe('/repo/apps');
    expect(agentDiffParentDir('a.ts')).toBe('');
    expect(agentDiffUsesInlinePreview('list')).toBe(true);
    expect(agentDiffUsesInlinePreview('tree')).toBe(false);
  });

  it('starts as a tree and switches to a flat list', async () => {
    render(
      <AgentDiffPanel cwd="/repo" isRemote={false} exited scope={null} />
    );
    await waitFor(() => {
      expect(screen.getByRole('tree', { name: 'Changed files' })).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Expand' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View as list' })).toBeTruthy();
    expect(screen.getByRole('treeitem', { expanded: true, name: /nested/ })).toBeTruthy();

    fireEvent.click(screen.getByTestId('agent-diff-list-mode'));
    expect(screen.getByRole('listbox', { name: 'Changed files' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Expand' })).toBeNull();
    expect(screen.getByRole('button', { name: 'View as tree' })).toBeTruthy();
    expect(screen.queryByRole('treeitem', { expanded: true, name: /nested/ })).toBeNull();
    expect(screen.getByRole('option', { name: /b\.ts/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /a\.ts/ })).toBeTruthy();

    fireEvent.click(screen.getByTestId('agent-diff-list-mode'));
    expect(screen.getByRole('tree', { name: 'Changed files' })).toBeTruthy();
  });

  it('opens the diff under the selected list row instead of a split preview', async () => {
    render(
      <AgentDiffPanel cwd="/repo" isRemote={false} exited scope={null} />
    );
    await waitFor(() => {
      expect(screen.getByRole('tree', { name: 'Changed files' })).toBeTruthy();
    });
    expect(screen.getByTestId('agent-diff-preview')).toBeTruthy();
    expect(screen.queryByTestId('agent-diff-inline-preview')).toBeNull();

    fireEvent.click(screen.getByTestId('agent-diff-list-mode'));
    await waitFor(() => {
      expect(screen.getByTestId('agent-diff-inline-preview')).toBeTruthy();
    });
    expect(screen.queryByTestId('agent-diff-preview')).toBeNull();
    expect(screen.getByRole('region', { name: /Diff for a\.ts/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('option', { name: /b\.ts/ }));
    expect(screen.getByRole('region', { name: /Diff for b\.ts/ })).toBeTruthy();
    expect(screen.queryByRole('region', { name: /Diff for a\.ts/ })).toBeNull();
    expect(screen.queryByTestId('agent-diff-preview')).toBeNull();
  });
});
