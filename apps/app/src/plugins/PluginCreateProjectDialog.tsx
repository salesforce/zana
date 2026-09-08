import type { PluginCreateProjectActionContext, PluginCreateProjectActionRegistration } from '@zana-ai/zcc-plugin-sdk';
import type { JsonValue } from '@zana-ai/zcc-domain/thread-runtime';
import { Modal } from '../components/Modal.js';
import { hrefForPluginProjectTab } from './plugin-nav-href.js';

export interface PluginCreateProjectDialogState {
  action: PluginCreateProjectActionRegistration;
  title: string;
  params: JsonValue | null;
}

export function PluginCreateProjectDialog({
  state,
  onClose,
  pickDirectory,
  addProject,
  cloneRoot,
  navigate
}: {
  state: PluginCreateProjectDialogState;
  onClose: () => void;
  pickDirectory(): Promise<string | null>;
  addProject(path: string): Promise<{ id: string } | null>;
  cloneRoot(): Promise<string | null>;
  navigate(to: string): void;
}) {
  const Component = state.action.component;
  if (!Component) return null;
  return (
    <Modal title={state.title} onClose={onClose} className="local-project-modal plugin-create-project-modal">
      <Component
        pluginId={state.action.pluginId}
        params={state.params}
        pickDirectory={pickDirectory}
        addProject={addProject}
        cloneRoot={cloneRoot}
        toProject={(id, options) => {
          navigate(hrefForPluginProjectTab(state.action.pluginId, id, options?.tabId));
        }}
        close={onClose}
      />
    </Modal>
  );
}

export function runCreateProjectAction(
  action: PluginCreateProjectActionRegistration,
  ctx: PluginCreateProjectActionContext
): void {
  const warn = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[plugin:${action.pluginId}] createProjectAction "${action.id}" failed: ${message}`);
  };
  try {
    const result = action.run(ctx);
    if (result instanceof Promise) void result.catch(warn);
  } catch (error) {
    warn(error);
  }
}
