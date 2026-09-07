export function remoteAddSubmitLabel(input: {
  installing: boolean;
  retry: boolean;
}): string {
  if (input.installing) return 'Installing…';
  if (input.retry) return 'Retry install';
  return 'Add and install';
}

export function collectBootstrapLogs(
  events: Array<{ type: string; text?: string }>
): string[] {
  return events.flatMap((event) => (event.type === 'log' && event.text ? [event.text] : []));
}
