export function saveIsDisabled(saveEnabled: boolean, activePath: string | null, busy: boolean): boolean {
  return !saveEnabled || !activePath || busy;
}

export function playgroundHint(
  hasStatus: boolean,
  dxProject: boolean | undefined,
  hasProjectFolder?: boolean
): string | null {
  if (hasProjectFolder) return null;
  if (hasStatus && !dxProject) {
    return 'Open a project with .agent files, or set a DX project root under Plugins → Salesforce.';
  }
  return null;
}

export const PLAYGROUND_READY_MS = 12_000;

export const PLAYGROUND_LOAD_ERROR =
  'Could not load the Agentforce playground. Rebuild the Salesforce plugin (`pnpm --dir plugins/salesforce run build`) or reinstall it.';

export function shouldShowPlaygroundFailure(args: {
  ready: boolean;
  iframeError: boolean;
  timedOut: boolean;
}): boolean {
  if (args.ready) return false;
  return args.iframeError || args.timedOut;
}
