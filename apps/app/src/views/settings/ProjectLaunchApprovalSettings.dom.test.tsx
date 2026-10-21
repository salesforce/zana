/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Project } from '@zana-ai/zcc-domain/product';

const get = vi.fn();
const set = vi.fn();
const pushToast = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/PopoverPicklist', () => ({
  PopoverPicklist: ({ value, onChange, ariaLabel, disabled }: { value: string; onChange: (v: string) => void; ariaLabel: string; disabled?: boolean }) => (
    <div>
      <span data-testid="picker" data-label={ariaLabel} data-value={value} data-disabled={String(!!disabled)} />
      <span role="button" onMouseDown={() => onChange('review')}>choose review</span>
      <span role="button" onMouseDown={() => onChange('bogus')}>choose bogus</span>
    </div>
  )
}));
vi.mock('@/store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useUi: (sel: (s: unknown) => unknown) => sel({ pushToast }) };
});

import { ProjectLaunchApprovalSettings } from './ProjectSettingsView.js';

const project: Project = { id: 'project-1', name: 'Project', path: '/tmp/project', createdAt: 0, lastActiveAt: 0 };

function renderSettings(onSaved = vi.fn()) {
  Object.defineProperty(window, 'cc', {
    configurable: true,
    value: { projectSettings: { get, set, onChanged: vi.fn(() => () => {}) } }
  });
  render(<ProjectLaunchApprovalSettings project={project} onSaved={onSaved} />);
  return onSaved;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as { cc?: unknown }).cc;
});

describe('ProjectLaunchApprovalSettings', () => {
  it('shows direct when the project has no setting', async () => {
    get.mockResolvedValue({});
    renderSettings();
    await waitFor(() => expect(screen.getByTestId('picker').getAttribute('data-value')).toBe('direct'));
  });

  it('shows a stored review setting', async () => {
    get.mockResolvedValue({ launchApproval: 'review' });
    renderSettings();
    await waitFor(() => expect(screen.getByTestId('picker').getAttribute('data-value')).toBe('review'));
  });

  it('saves the chosen policy and reports it saved', async () => {
    get.mockResolvedValue({});
    set.mockResolvedValue({ launchApproval: 'review' });
    const onSaved = renderSettings();
    await waitFor(() => screen.getByTestId('picker'));
    fireEvent.mouseDown(screen.getByText('choose review'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(set).toHaveBeenCalledWith('project-1', { launchApproval: 'review' });
    expect(screen.getByTestId('picker').getAttribute('data-value')).toBe('review');
  });

  it('ignores a value that is not a policy', async () => {
    get.mockResolvedValue({});
    renderSettings();
    await waitFor(() => screen.getByTestId('picker'));
    fireEvent.mouseDown(screen.getByText('choose bogus'));
    expect(set).not.toHaveBeenCalled();
  });

  it('rolls back and reports when saving fails', async () => {
    get.mockResolvedValue({});
    set.mockRejectedValue(new Error('disk full'));
    const onSaved = renderSettings();
    await waitFor(() => screen.getByTestId('picker'));
    fireEvent.mouseDown(screen.getByText('choose review'));
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('disk full'), 'error'));
    expect(screen.getByTestId('picker').getAttribute('data-value')).toBe('direct');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('shows the load error', async () => {
    get.mockRejectedValue(new Error('offline'));
    renderSettings();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('offline'));
  });
});
