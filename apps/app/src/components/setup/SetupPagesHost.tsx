import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Laptop, Server } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useData, useUi } from '../../store.js';
import { product } from '../../lib/product-client.js';
import { getProjectRoutePath } from '../../lib/route-paths.js';
import { AddMachineProjectDialog } from '../AddMachineProjectDialog.js';
import { PluginCreateProjectDialog } from '../../plugins/PluginCreateProjectDialog.js';
import { AddMachineDialog } from '../../views/settings/AddMachineDialog.js';
import {
  defaultSshHost,
  sshHostOptionsFromProjects
} from '../../views/settings/machine-pairing.js';
import { SetupPageContext } from './SetupFrame.js';
import { setupPath, useSetupPages, type SetupPage } from './setup-pages.js';
import './setup-pages.css';

function SetupDraft({ page, active }: { page: SetupPage; active: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = useRef(location.pathname);
  currentPath.current = location.pathname;
  const [config, setConfig] = useState<Awaited<
    ReturnType<typeof product.config.get>
  > | null>(null);
  useEffect(() => {
    if (page.request.kind !== 'machine') return;
    let current = true;
    void product.config
      .get()
      .then((value) => {
        if (current) setConfig(value);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [page.request.kind]);
  const projects = useData((s) => s.projects);
  const setBusy = useCallback(
    (busy: boolean) => useSetupPages.getState().setBusy(page.id, busy),
    [page.id]
  );
  const context = useMemo(() => ({ active, setBusy }), [active, setBusy]);
  const close = () => {
    const exists = useSetupPages
      .getState()
      .pages.some((row) => row.id === page.id);
    if (
      exists &&
      useSetupPages.getState().close(page.id) &&
      currentPath.current === setupPath(page.id)
    )
      void navigate(page.returnPath);
  };
  const added = (project: { id: string }) => {
    setBusy(false);
    useSetupPages.getState().close(page.id);
    if (currentPath.current === setupPath(page.id))
      void navigate(getProjectRoutePath(project.id));
    else useUi.getState().pushToast('Project added');
  };
  const request = page.request;
  return (
    <div className="setup-draft" hidden={!active} inert={!active}>
      <SetupPageContext.Provider value={context}>
        {request.kind === 'project' ? (
          <AddMachineProjectDialog
            group={request.group}
            initialMode={request.mode}
            onAdded={added}
            onClose={close}
          />
        ) : request.kind === 'plugin' ? (
          <PluginCreateProjectDialog
            state={request.state}
            onClose={close}
            pickDirectory={() => product.projects.pickDirectory()}
            addProject={async (path) => {
              const p = await useData.getState().addProjectByPath(path);
              return p ? { id: p.id } : null;
            }}
            cloneRoot={() => product.projects.cloneRoot()}
            navigate={(to) => {
              if (currentPath.current === setupPath(page.id)) {
                currentPath.current = to;
                void navigate(to);
              }
            }}
          />
        ) : (
          <AddMachineDialog
            open
            onClose={close}
            publicAppUrl={config?.publicAppUrl}
            sshHosts={sshHostOptionsFromProjects(projects)}
            defaultSshHost={defaultSshHost(projects, config?.lastProjectId)}
          />
        )}
      </SetupPageContext.Provider>
    </div>
  );
}

export function SetupPagesHost() {
  const pages = useSetupPages((s) => s.pages);
  const location = useLocation();
  const navigate = useNavigate();
  const showing = location.pathname.startsWith('/setup/');
  const active = pages.find((page) => setupPath(page.id) === location.pathname);
  const group =
    active?.request.kind !== 'machine' ? active?.request.group : null;
  return (
    <div className="setup-pages" hidden={!showing}>
      {showing && (
        <div className="setup-pages-breadcrumb">
          <button
            type="button"
            onClick={() => void navigate(active?.returnPath ?? '/')}
          >
            <ArrowLeft size={13} />
            Back
          </button>
          <span>
            Machines /{' '}
            {active ? (group ? 'Add project' : 'Connect a machine') : 'Setup'}
          </span>
          {group && (
            <span className="setup-target">
              {group.primary ? <Laptop size={14} /> : <Server size={14} />}
              {group.name}
            </span>
          )}
        </div>
      )}
      {showing && !active && (
        <div className="setup-form">
          <h1>This setup is no longer open</h1>
          <p>Use the + beside a machine to start a new setup.</p>
        </div>
      )}
      {pages.map((page) => (
        <SetupDraft
          key={page.id}
          page={page}
          active={showing && page.id === active?.id}
        />
      ))}
    </div>
  );
}
