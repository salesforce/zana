export function mentionPillLabel(mention: {
  resource?: { kind?: string; label?: string; path?: string; name?: string };
}): string {
  const resource = mention.resource;
  if (!resource) return '';
  if (typeof resource.label === 'string' && resource.label.trim()) return resource.label;
  if (typeof resource.path === 'string' && resource.path.trim()) return resource.path;
  if (typeof resource.name === 'string' && resource.name.trim()) return resource.name;
  return resource.kind ?? '';
}
