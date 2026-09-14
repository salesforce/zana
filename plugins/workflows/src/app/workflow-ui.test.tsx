/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPluginApp, renderSlot } from '@zana-ai/zcc-plugin-sdk/testing/app';
import type { WorkflowRunView } from '../ui-contract.js';

vi.mock('./styles.css', () => ({ default: '.wf-panel{}' }));

const RUN: WorkflowRunView = {
  id: 'wfr_11111111-1111-4111-8111-111111111111',
  name: 'review-change',
  description: 'Review a change',
  status: 'running',
  currentPhase: 'Review',
  phases: [
    {
      title: 'Review',
      detail: null,
      calls: [
        {
          id: 'wfc_1',
          index: 0,
          label: 'Review the tree',
          phase: 'Review',
          status: 'running',
          provider: 'fake',
          model: 'gpt-test',
          reasoningLevel: 'medium',
          cached: false,
          childThreadId: 'thread-worker',
          providerRetryAttempts: 0,
          repairAttempts: 0,
          error: null,
          createdAt: 1,
          startedAt: 1,
          finishedAt: null
        }
      ]
    }
  ],
  unphasedCalls: [],
  resultAvailable: false,
  error: null,
  createdAt: 1,
  startedAt: 1,
  finishedAt: null
};

const app = await loadPluginApp(() => import('../../app.tsx'), 'workflows');

afterEach(() => {
  cleanup();
  document.getElementById('wf-plugin-styles')?.remove();
});

describe('workflows plugin app', () => {
  it('registers preview directive, composer banner, and thread inspector', () => {
    expect(app.messageDirectives[0]?.id).toBe('workflow-preview');
    expect(app.composerCustomizations[0]?.id).toBe('workflow-status');
    expect(app.composerCustomizations[0]?.banners?.[0]?.id).toBe('active-runs');
    expect(app.threadPanelActions[0]).toMatchObject({
      id: 'workflow-run',
      title: 'Workflow run'
    });
  });

  it('renders a live preview card and opens the inspector', async () => {
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        pluginId: 'workflows',
        attributes: { run: RUN.id },
        source: `::workflow-preview{run="${RUN.id}"}`,
        message: {
          id: 'msg-1',
          threadId: 'thread-origin',
          turnId: null,
          projectId: 'project-1'
        },
        openWorkspaceFile: null
      },
      {
        rpc: {
          workflowRunView: () => ({ run: RUN })
        }
      }
    );
    expect(await slot.findByText('review-change')).toBeTruthy();
    fireEvent.click(slot.getByRole('button', { name: 'Open workflow review-change in side panel' }));
    await waitFor(() => {
      expect(slot.inspection.navigateCalls.some((call) => call.method === 'openThreadPanel')).toBe(true);
    });
    slot.unmount();
  });

  it('rejects a malformed preview directive', () => {
    const slot = renderSlot(app.messageDirectives[0]!, {
      pluginId: 'workflows',
      attributes: { run: RUN.id, extra: 'nope' },
      source: `::workflow-preview{run="${RUN.id}" extra="nope"}`,
      message: {
        id: 'msg-1',
        threadId: 'thread-origin',
        turnId: null,
        projectId: 'project-1'
      },
      openWorkspaceFile: null
    });
    expect(slot.getByText(/exactly one valid run attribute/)).toBeTruthy();
    slot.unmount();
  });

  it('renders active runs on the composer banner', async () => {
    const slot = renderSlot(
      app.composerCustomizations[0]!.banners![0]!,
      {},
      {
        composer: { scope: { kind: 'thread', threadId: 'thread-origin' } },
        rpc: {
          workflowActiveRuns: () => ({ runs: [RUN] })
        }
      }
    );
    expect(await slot.findByText('review-change')).toBeTruthy();
    slot.unmount();
  });

  it('reads the thread id from the URL when composer scope is not a thread', async () => {
    window.history.pushState({}, '', '/threads/thread-origin');
    const slot = renderSlot(
      app.composerCustomizations[0]!.banners![0]!,
      {},
      {
        composer: { scope: { kind: 'new-thread', projectId: 'project-1' } },
        rpc: {
          workflowActiveRuns: () => ({ runs: [RUN] })
        }
      }
    );
    expect(await slot.findByText('review-change')).toBeTruthy();
    slot.unmount();
    window.history.pushState({}, '', '/');
  });
});
