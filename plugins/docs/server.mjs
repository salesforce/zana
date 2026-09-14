import {
  filterLibraryMentionDocs,
  formatLibraryMentionContext,
  parseLibraryMentionId
} from './src/library-mentions.js';

export default function plugin(zcc, deps = {}) {
  zcc.log.info('docs plugin loaded');
  const library = deps.library ?? zcc.sdk.library;

  zcc.rpc.method('read', async (args) => {
    const scope = args?.scope === 'global' ? 'global' : 'project';
    const relPath = typeof args?.path === 'string' ? args.path.trim() : '';
    const projectId = typeof args?.projectId === 'string' ? args.projectId.trim() : undefined;
    if (!relPath) throw new Error('path is required');
    return library.read({
      scope,
      relPath,
      ...(projectId ? { projectId } : {})
    });
  });

  zcc.rpc.method('write', async (args) => {
    const scope = args?.scope === 'global' ? 'global' : 'project';
    const relPath = typeof args?.path === 'string' ? args.path.trim() : '';
    const content = typeof args?.content === 'string' ? args.content : null;
    const projectId = typeof args?.projectId === 'string' ? args.projectId.trim() : undefined;
    if (!relPath) throw new Error('path is required');
    if (content === null) throw new Error('content is required');
    return library.write({
      scope,
      relPath,
      content,
      ...(projectId ? { projectId } : {})
    });
  });

  zcc.ui.registerMentionProvider({
    id: 'note',
    label: 'Docs',
    async search(ctx) {
      const query = typeof ctx === 'string' ? ctx : ctx?.query;
      const projectId = typeof ctx === 'object' && ctx ? ctx.projectId : undefined;
      const docs = await library.list(projectId ? { projectId } : {});
      return filterLibraryMentionDocs(docs, { query, projectId });
    },
    async resolve(itemId) {
      const parsed = parseLibraryMentionId(itemId);
      if (!parsed) throw new Error(`unknown note: ${itemId}`);
      const result = await library.read({
        scope: parsed.scope,
        relPath: parsed.relPath,
        ...(parsed.projectId ? { projectId: parsed.projectId } : {})
      });
      if (!result?.ok) throw new Error(`unknown note: ${itemId}`);
      const title = parsed.relPath.split('/').pop() || parsed.relPath;
      return { context: formatLibraryMentionContext(title, result.content) };
    }
  });
}
