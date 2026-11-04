import type { LibraryDoc } from '@zana-ai/zcc-domain/product';
import type { DocumentLink } from '../../../components/document-links.js';

/** Match only catalogued documents in the source's scope; main authorizes the eventual read. */
export function findLinkedLibraryDocument(docs: readonly LibraryDoc[], source: LibraryDoc, link: DocumentLink): LibraryDoc | undefined {
  return docs.find(doc =>
    (doc.scope ?? 'global') === (source.scope ?? 'global') && doc.projectId === source.projectId &&
    (doc.relPath === link.path.replace(/^\//u, '') || doc.absPath === link.path)
  );
}
