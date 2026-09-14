/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { loadPluginApp, renderSlot } from '@zana-ai/zcc-plugin-sdk/testing/app';

afterEach(() => {
  cleanup();
});

describe('DocDirectiveCard', () => {
  const message = {
    id: 'm1',
    threadId: 't1',
    turnId: null,
    projectId: 'p1'
  };

  it('opens the document panel for a library-relative path', async () => {
    const app = await loadPluginApp(() => import('../../app.tsx'), 'docs');
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        pluginId: 'docs',
        attributes: { path: 'findings/auth.md', title: 'Auth findings' },
        source: '::doc{path="findings/auth.md"}',
        message,
        openWorkspaceFile: null
      }
    );
    slot.getByText('Auth findings').closest('button')?.click();
    expect(slot.inspection.navigateCalls).toEqual([{
      method: 'openThreadPanel',
      options: {
        actionId: 'document',
        title: 'Auth findings',
        params: {
          path: 'findings/auth.md',
          scope: 'project',
          title: 'Auth findings',
          projectId: 'p1'
        }
      }
    }]);
  });

  it('navigates to Library from the secondary action', async () => {
    const app = await loadPluginApp(() => import('../../app.tsx'), 'docs');
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        pluginId: 'docs',
        attributes: { path: 'findings/auth.md', title: 'Auth findings' },
        source: '::doc{path="findings/auth.md"}',
        message,
        openWorkspaceFile: null
      }
    );
    slot.getByTitle('Open in Library').click();
    expect(slot.inspection.navigateCalls).toEqual([{
      method: 'toPluginPanel',
      path: 'panel',
      options: { subPath: 'project/p1/findings/auth.md' }
    }]);
  });
});
