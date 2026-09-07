/**
 * CLI Agent "Local agent · remote tools": the process is local; only tools
 * go over SSH. Preflight must use local model/role scope (Cursor is local-only)
 * even though `project.remote` is set. Renderer `remoteToolProxy` is advisory —
 * main honors it only when Experimental is on and the store project is SSH.
 */

export function usesCliRemoteToolProxy(
  project: { remote?: unknown },
  req: { remoteToolProxy?: boolean },
  config: { cliRemoteToolProxyEnabled?: boolean }
): boolean {
  return Boolean(req.remoteToolProxy)
    && config.cliRemoteToolProxyEnabled === true
    && Boolean(project.remote);
}

export function launchExecutionScope(
  project: { remote?: unknown },
  req: { remoteToolProxy?: boolean },
  config: { cliRemoteToolProxyEnabled?: boolean }
): 'local' | 'remote' {
  return project.remote && !usesCliRemoteToolProxy(project, req, config) ? 'remote' : 'local';
}
