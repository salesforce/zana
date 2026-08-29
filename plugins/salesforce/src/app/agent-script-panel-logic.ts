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
