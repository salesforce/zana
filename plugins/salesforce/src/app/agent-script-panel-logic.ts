export function filePickerValue(activePath: string | null, exampleId: string): string {
  return activePath ? `file:${activePath}` : `example:${exampleId}`;
}

export function parseFilePickerValue(
  value: string
): { kind: 'file'; path: string } | { kind: 'example'; id: string } {
  if (value.startsWith('example:')) {
    return { kind: 'example', id: value.slice('example:'.length) };
  }
  const path = value.startsWith('file:') ? value.slice('file:'.length) : value;
  return { kind: 'file', path };
}

export function saveIsDisabled(saveEnabled: boolean, activePath: string | null, busy: boolean): boolean {
  return !saveEnabled || !activePath || busy;
}

export function playgroundHint(hasStatus: boolean, dxProject: boolean | undefined): string | null {
  if (hasStatus && !dxProject) {
    return 'Examples are in-memory until you set a DX project root under Plugins → Salesforce.';
  }
  return null;
}

export const PLAYGROUND_READY_MS = 12_000;

export const PLAYGROUND_LOAD_ERROR =
  'Could not load the Agent Script playground. Rebuild the Salesforce plugin (`pnpm --dir plugins/salesforce run build`) or reinstall it.';

export function shouldShowPlaygroundFailure(args: {
  ready: boolean;
  iframeError: boolean;
  timedOut: boolean;
}): boolean {
  if (args.ready) return false;
  return args.iframeError || args.timedOut;
}
