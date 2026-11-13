import { canonicalPeerHash } from '../shared/peer-contract.js';

interface DigestStore {
  list(filter: { status: 'all' }): Array<{ id: string; status?: string; title?: string; summary?: string; tags?: string[]; entryPath?: string }>;
  readAllFiles(ref: string): Array<{ path: string; encoding: string; content: string }>;
}
interface DigestSyncStore {
  localRepository(): { repoId: string } | null;
  head(repoId: string, docId: string): string | null;
}

/**
 * Convergence-stable digest of the local database: document ids plus each file's path, encoding and content.
 * Per-replica sync heads are deliberately excluded because a merge can give two converged replicas different heads.
 * Opaque: the hash reveals neither names, counts nor content. The costly content pass is cached against the cheap
 * head fingerprint, which changes whenever any document changes.
 */
export function createStateDigest(store: DigestStore, sync: DigestSyncStore): () => string | null {
  let cached: { key: string; digest: string } | null = null;
  return () => {
    const local = sync.localRepository();
    if (!local) return null;
    const rows = store.list({ status: 'all' }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const docs = rows.map(doc => doc.id);
    const key = canonicalPeerHash(docs.map((docId) => [docId, sync.head(local.repoId, docId)]));
    if (cached?.key === key) return cached.digest;
    const digest = canonicalPeerHash(rows.map(({ id, status, title, summary, tags, entryPath }) => [id,
      { status: status ?? null, title: title ?? null, summary: summary ?? null, tags: tags ?? [], entryPath: entryPath ?? null },
      store.readAllFiles(id).map((file) => [file.path, file.encoding, canonicalPeerHash(file.content)]).sort()]));
    cached = { key, digest };
    return digest;
  };
}
