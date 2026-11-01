/** Preserve chosen names; use the host portion of a fully qualified hostname for compact UI. */
export function computerLabel(name: string): string {
  const value = name.trim();
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(value) ? value.split('.')[0]! : value || 'Unnamed computer';
}
