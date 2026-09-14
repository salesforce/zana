const MENTION_CAP = 25;

export function libraryMentionId(doc) {
  return `${doc.scope}:${doc.projectId ?? 'global'}:${doc.relPath}`;
}

export function parseLibraryMentionId(itemId) {
  const raw = String(itemId ?? '').trim();
  const first = raw.indexOf(':');
  const second = first === -1 ? -1 : raw.indexOf(':', first + 1);
  if (first <= 0 || second <= first) return null;
  const scope = raw.slice(0, first);
  const owner = raw.slice(first + 1, second);
  const relPath = raw.slice(second + 1);
  if (!relPath || relPath.split('/').includes('..')) return null;
  if (scope === 'global') return { scope: 'global', relPath };
  if (scope === 'project' && owner) return { scope: 'project', projectId: owner, relPath };
  return null;
}

export function filterLibraryMentionDocs(docs, { query, projectId }) {
  const needle = String(query ?? '').trim().toLowerCase();
  const scopedProjectId = typeof projectId === 'string' ? projectId.trim() : '';
  return (Array.isArray(docs) ? docs : [])
    .filter((doc) => {
      if (doc?.scope === 'global') return true;
      return Boolean(scopedProjectId) && doc?.projectId === scopedProjectId;
    })
    .filter((doc) => {
      if (!needle) return true;
      const title = String(doc.title ?? '').toLowerCase();
      const relPath = String(doc.relPath ?? '').toLowerCase();
      const summary = String(doc.summary ?? '').toLowerCase();
      return title.includes(needle) || relPath.includes(needle) || summary.includes(needle);
    })
    .slice(0, MENTION_CAP)
    .map((doc) => ({
      id: libraryMentionId(doc),
      label: String(doc.title || doc.relPath || 'Untitled')
    }));
}

export function formatLibraryMentionContext(title, content) {
  const heading = String(title || 'Library document').trim() || 'Library document';
  const body = String(content ?? '');
  return `# ${heading}\n\n${body}`;
}
