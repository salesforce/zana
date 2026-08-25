export type MentionLabelResource = {
  kind?: string;
  label?: string;
  path?: string;
  name?: string;
  entryKind?: string;
};

export function mentionResourceValue(resource?: MentionLabelResource): string {
  if (!resource) return '';
  if (typeof resource.label === 'string' && resource.label.trim()) return resource.label;
  if (typeof resource.path === 'string' && resource.path.trim()) return resource.path;
  if (typeof resource.name === 'string' && resource.name.trim()) return resource.name;
  return resource.kind ?? '';
}

export function mentionKindTitle(resource?: MentionLabelResource): string {
  const kind = resource?.kind;
  if (kind === 'thread') return 'Thread';
  if (kind === 'project') return 'Project';
  if (kind === 'command') return 'Command';
  if (kind === 'path') {
    return resource?.entryKind === 'directory' ? 'Folder' : 'File';
  }
  return '';
}

/** Visible mention text: kind title next to the value, e.g. "Thread: Hello". */
export function mentionDisplayLabel(resource?: MentionLabelResource): string {
  const value = mentionResourceValue(resource);
  const kind = resource?.kind;
  if (kind !== 'thread' && kind !== 'project') return value;
  const title = mentionKindTitle(resource);
  if (!title) return value;
  if (!value || value === title) return title;
  if (value.startsWith(`${title}: `)) return value;
  return `${title}: ${value}`;
}
