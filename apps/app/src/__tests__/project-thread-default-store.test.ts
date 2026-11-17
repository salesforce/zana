import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('../lib/product-client.js', () => ({ product: { projects: { update: mocks.update } } }));
import { useData, useUi } from '../store.js';

const project = { id: 'p', name: 'Project', path: '/project', lastActiveAt: 10, sortIndex: 2 } as Project;
beforeEach(() => {
  mocks.update.mockReset();
  useData.setState({ projects: [project] });
});
afterEach(() => { for (const toast of useUi.getState().toasts) useUi.getState().dismissToast(toast.id); });

describe('project thread-default persistence', () => {
  it('adopts the committed provider while preserving sidebar order', async () => {
    mocks.update.mockResolvedValue({ ...project, defaultThreadProviderId: 'custom', lastActiveAt: 99, sortIndex: 9 });
    await useData.getState().updateProject('p', { defaultThreadProviderId: 'custom' }, { throwOnError: true });
    expect(mocks.update).toHaveBeenCalledWith('p', { defaultThreadProviderId: 'custom' });
    expect(useData.getState().projects[0]).toMatchObject({ defaultThreadProviderId: 'custom', lastActiveAt: 10, sortIndex: 2 });
  });
  it('keeps the previous projection and exposes requested save failures', async () => {
    mocks.update.mockRejectedValue(new Error('disk failed'));
    await expect(useData.getState().updateProject('p', { defaultThreadProviderId: 'custom' }, { throwOnError: true })).rejects.toThrow('disk failed');
    expect(useData.getState().projects[0]).toEqual(project);
    await expect(useData.getState().updateProject('p', { defaultThreadProviderId: 'custom' })).resolves.toBeUndefined();
  });
  it('treats a deleted project as a failed save when requested', async () => {
    mocks.update.mockResolvedValue(null);
    await expect(useData.getState().updateProject('p', { defaultThreadProviderId: null }, { throwOnError: true })).rejects.toThrow('Project no longer exists');
    await expect(useData.getState().updateProject('p', { defaultThreadProviderId: null })).resolves.toBeUndefined();
    expect(useData.getState().projects).toEqual([project]);
  });
});
