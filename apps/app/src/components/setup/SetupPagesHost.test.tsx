// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { SetupPagesHost } from './SetupPagesHost.js';
import { ApplicationTabs } from '../ApplicationTabs.js';
import { SetupFrame, useSetupBusy } from './SetupFrame.js';
import { useSetupNavigation } from './useSetupNavigation.js';
import { setupPath, useSetupPages, type SetupRequest } from './setup-pages.js';
import { useApplicationTabs } from '../../lib/application-tabs.js';
vi.mock('../../lib/windowScope.js', () => ({ getScopedProjectId: () => null }));
vi.mock('../../thread-store.js', () => ({
  useThreads: Object.assign((fn: any) => fn({ threads: [] }), { getState: () => ({ load: async () => {} }) }),
  onThreadArchived: () => () => {}
}));
const h = vi.hoisted(() => ({
  toast: vi.fn(),
  add: vi.fn(async () => ({ id: 'new' })),
  done: undefined as undefined | ((p: { id: string }) => void),
  props: {} as any
}));
vi.mock('../../store.js', () => ({
  useData: Object.assign((fn: any) => fn({ projects: [] }), {
    getState: () => ({ addProjectByPath: h.add })
  }),
  useUi: { getState: () => ({ pushToast: h.toast }) }
}));
vi.mock('../../lib/product-client.js', () => ({
  product: {
    config: { get: async () => ({ lastProjectId: null }) },
    projects: {
      pickDirectory: async () => '/picked',
      cloneRoot: async () => '/projects'
    }
  }
}));
vi.mock('../../views/settings/machine-pairing.js', () => ({
  defaultSshHost: () => '',
  sshHostOptionsFromProjects: () => []
}));
vi.mock('../AddMachineProjectDialog.js', () => ({
  AddMachineProjectDialog: (props: any) => {
    h.done = props.onAdded;
    const [value, setValue] = useState(''),
      [busy, setBusy] = useState(false);
    useSetupBusy(busy);
    return (
      <SetupFrame title="Add folder" onClose={props.onClose}>
        <input
          aria-label="Draft path"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button onClick={() => setBusy(!busy)}>Toggle busy</button>
        <button onClick={() => props.onAdded({ id: 'new' })}>Finish</button>
        <button onClick={props.onClose}>Cancel</button>
      </SetupFrame>
    );
  }
}));
vi.mock('../../plugins/PluginCreateProjectDialog.js', () => ({
  PluginCreateProjectDialog: (props: any) => {
    h.props = props;
    return (
      <SetupFrame title="Plugin setup" onClose={props.onClose}>
        <button onClick={props.onClose}>Close plugin</button>
      </SetupFrame>
    );
  }
}));
vi.mock('../../views/settings/AddMachineDialog.js', () => ({
  AddMachineDialog: (props: any) => {
    h.props = props;
    return (
      <SetupFrame title="Connect a machine" onClose={props.onClose}>
        SSH / Installer command
        <button onClick={props.onClose}>Cancel machine</button>
      </SetupFrame>
    );
  }
}));
const request: SetupRequest = {
  kind: 'project',
  group: { id: 'mac', name: 'This Mac', primary: true, projects: [] },
  mode: 'open'
};
function Controls() {
  const go = useNavigate(),
    location = useLocation(),
    open = useSetupNavigation();
  return (
    <>
      <button onClick={() => go('/threads/t')}>Conversation</button>
      <button onClick={() => open(request)}>New setup</button>
      <output data-testid="path">{location.pathname}</output>
    </>
  );
}
function mount(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Controls />
      <div role="tablist">
        <ApplicationTabs includeThreads={false} />
      </div>
      <SetupPagesHost />
    </MemoryRouter>
  );
}
beforeEach(() => {
  useApplicationTabs.setState({ open: [], closed: [], initializedScope: undefined });
  sessionStorage.clear();
  useSetupPages.setState({ pages: [] });
  h.toast.mockClear();
});
afterEach(cleanup);
it('opens a normal page, preserves its input across tab switches and finishes without an overlay', async () => {
  mount();
  fireEvent.click(screen.getByText('New setup'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Draft path' }), { target: { value: '/work' } });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByText('Conversation'));
  expect(screen.queryByRole('textbox', { name: 'Draft path' })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Add folder · This Mac' }));
  expect((screen.getByRole('textbox', { name: 'Draft path' }) as HTMLInputElement).value).toBe('/work');
  fireEvent.click(screen.getByText('Toggle busy'));
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Close tab: Add folder · This Mac'
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
  );
  fireEvent.click(screen.getByText('Finish'));
  expect(screen.getByTestId('path').textContent).toBe('/projects/new');
  expect(useSetupPages.getState().pages).toHaveLength(0);
});
it('does not steal navigation on background completion, supports cancel/back and stale URLs', async () => {
  const id = useSetupPages.getState().open(request, '/threads/t')!;
  mount(setupPath(id));
  fireEvent.click(screen.getByText('Conversation'));
  h.done!({ id: 'new' });
  await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Project added'));
  expect(screen.getByTestId('path').textContent).toBe('/threads/t');
  fireEvent.click(screen.getByText('New setup'));
  fireEvent.click(screen.getByText('Cancel'));
  expect(screen.getByTestId('path').textContent).toBe('/threads/t');
  cleanup();
  mount('/setup/missing');
  expect(screen.getByText('This setup is no longer open')).toBeTruthy();
  fireEvent.click(screen.getByText('Back'));
  expect(screen.getByTestId('path').textContent).toBe('/');
});
it('hosts plugin forms and machine connection on the same page surface and retains back navigation', async () => {
  const state = {
    title: 'Plugin',
    params: null,
    action: { id: 'new', pluginId: 'crm', generation: 1 }
  } as any;
  const id = useSetupPages
    .getState()
    .open({ kind: 'plugin', group: request.group, state }, '/')!;
  mount(setupPath(id));
  expect(screen.getByRole('heading', { name: 'Plugin setup' })).toBeTruthy();
  expect(await h.props.pickDirectory()).toBe('/picked');
  expect(await h.props.cloneRoot()).toBe('/projects');
  expect(await h.props.addProject('/work')).toEqual({ id: 'new' });
  h.props.navigate('/projects/new');
  h.props.onClose();
  await waitFor(() =>
    expect(screen.getByTestId('path').textContent).toBe('/projects/new')
  );
  expect(useSetupPages.getState().pages).toHaveLength(0);
  cleanup();
  const mid = useSetupPages
    .getState()
    .open({ kind: 'machine' }, '/settings/machines')!;
  mount(setupPath(mid));
  expect(screen.getByText('SSH / Installer command')).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: 'Close tab: Connect a machine' })
  );
  expect(screen.getByTestId('path').textContent).toBe('/agents');
});
it('bounds draft growth and reports the cap', () => {
  for (let i = 0; i < 12; i++)
    useSetupPages.getState().open(
      {
        kind: 'project',
        group: { ...request.group, id: String(i) },
        mode: 'open'
      },
      '/'
    );
  mount();
  fireEvent.click(screen.getByText('New setup'));
  expect(h.toast).toHaveBeenCalledWith(
    'Close a setup tab before opening another',
    'error'
  );
});
