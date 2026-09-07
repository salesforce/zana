export function parseDocDirectiveAttributes(attributes) {
  const path = typeof attributes?.path === 'string' ? attributes.path.trim() : '';
  if (!path || path.split(/[/\\]/).includes('..')) return null;
  const title = typeof attributes?.title === 'string' && attributes.title.trim()
    ? attributes.title.trim()
    : path.split(/[/\\]/).pop() || path;
  const vault = typeof attributes?.vault === 'string' && attributes.vault.trim()
    ? attributes.vault.trim()
    : null;
  return { path, title, vault };
}
