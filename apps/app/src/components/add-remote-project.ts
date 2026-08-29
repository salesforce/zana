export function remoteAddSubmitLabel(input: {
  installHost: boolean;
  installing: boolean;
  retry: boolean;
}): string {
  if (input.installing) return 'Installing…';
  if (input.retry) return 'Retry install';
  return input.installHost ? 'Add and install' : 'Add project';
}

export function collectBootstrapLogs(
  events: Array<{ type: string; text?: string }>
): string[] {
  return events.flatMap((event) => (event.type === 'log' && event.text ? [event.text] : []));
}
