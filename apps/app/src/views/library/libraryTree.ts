import type { LibraryDoc, LibraryScope } from '@zana-ai/zcc-domain/product';

/**
 * A folder the user just created via "New folder" but that has no doc in it
 * yet. The store's `createFolder` really does `mkdirSync` on disk, but
 * `list()`/`reconcile()` only ever surfaces FILES (an empty directory has no
 * doc to stamp), so a brand-new empty folder would otherwise vanish from the
 * tree the instant it's created — the user creates it, sees nothing, and
 * assumes it failed. Tracking it client-side (for this session) keeps it
 * visible until a real doc lands inside, at which point the doc's own relPath
 * materializes the same dir node anyway and the phantom becomes redundant
 * (harmless — `buildLibraryTree` de-dupes by key).
 */
export interface LibraryPhantomFolder {
  scope: LibraryScope;
  projectId?: string;
  relPath: string;
}

export interface LibraryTreeNode {
  /** Stable key: `${bucketKey}:${relPath}` — unique within the whole tree. */
  key: string;
  name: string;
  kind: 'dir' | 'file';
  scope: LibraryScope;
  projectId?: string;
  /** Path relative to the scope+project's own library dir. '' for a bucket root. */
  relPath: string;
  /** True for the one synthetic top-level node per scope bucket (Global / a project). */
  isBucketRoot?: boolean;
  children?: LibraryTreeNode[];
  /** Present only on a file node. */
  doc?: LibraryDoc;
  /** Recursive doc count under a dir (including a bucket root). Undefined for files. */
  count?: number;
}

/** Stable per-scope(+project) bucket key, shared by the tree builder and callers that need to compute a node's key without walking the tree (e.g. right after creating a folder). */
export function libraryBucketKey(scope: LibraryScope, projectId?: string): string {
  return scope === 'project' ? `project:${projectId ?? 'unknown'}` : 'global';
}

/** Stable node key for any relPath (dir or file) within a bucket. */
export function libraryNodeKey(bucketKey: string, relPath: string): string {
  return `${bucketKey}:${relPath}`;
}

/**
 * Build one root per scope-bucket (Global + one per project that owns at
 * least one visible doc), each a REAL nested folder tree derived from
 * `doc.relPath` — the folder-tree UI's data model (a file-explorer view over
 * the library, not the old flat scope-bucket grouping). Dirs sort before
 * files, then alphabetically. `phantomFolders` materializes empty dirs that
 * have no doc yet (see {@link LibraryPhantomFolder}); a phantom for a bucket
 * that has no real docs is silently dropped — the UI can only ever create one
 * from a context menu on an already-visible node, so that bucket already
 * exists whenever a phantom for it is passed in.
 */
export function buildLibraryTree(
  docs: LibraryDoc[],
  phantomFolders: LibraryPhantomFolder[] = []
): LibraryTreeNode[] {
  interface Bucket {
    label: string;
    scope: LibraryScope;
    projectId?: string;
    docs: LibraryDoc[];
  }
  const buckets = new Map<string, Bucket>();
  for (const doc of docs) {
    const scope: LibraryScope = doc.scope === 'project' ? 'project' : 'global';
    const key = libraryBucketKey(scope, doc.projectId);
    const label = scope === 'project' ? doc.projectName ?? doc.projectId ?? 'Project' : 'Global';
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { label, scope, projectId: doc.projectId, docs: [] };
      buckets.set(key, bucket);
    }
    bucket.docs.push(doc);
  }

  const phantomsByBucket = new Map<string, string[]>();
  for (const pf of phantomFolders) {
    const key = libraryBucketKey(pf.scope, pf.projectId);
    const list = phantomsByBucket.get(key);
    if (list) list.push(pf.relPath);
    else phantomsByBucket.set(key, [pf.relPath]);
  }

  const roots: LibraryTreeNode[] = [];
  for (const [bucketKey, bucket] of buckets) {
    const dirIndex = new Map<string, LibraryTreeNode>();
    const top: LibraryTreeNode[] = [];

    const ensureDir = (segments: string[]): LibraryTreeNode[] => {
      if (segments.length === 0) return top;
      const relPath = segments.join('/');
      const dirKey = libraryNodeKey(bucketKey, relPath);
      let node = dirIndex.get(dirKey);
      if (!node) {
        const parentChildren = ensureDir(segments.slice(0, -1));
        node = {
          key: dirKey,
          name: segments[segments.length - 1],
          kind: 'dir',
          scope: bucket.scope,
          projectId: bucket.projectId,
          relPath,
          children: [],
          count: 0
        };
        dirIndex.set(dirKey, node);
        parentChildren.push(node);
      }
      return node.children!;
    };

    for (const doc of bucket.docs) {
      const parts = doc.relPath.split('/').filter(Boolean);
      const fileName = parts.pop() ?? doc.relPath;
      const siblings = ensureDir(parts);
      siblings.push({
        key: libraryNodeKey(bucketKey, doc.relPath),
        name: fileName,
        kind: 'file',
        scope: bucket.scope,
        projectId: bucket.projectId,
        relPath: doc.relPath,
        doc
      });
      for (let i = 1; i <= parts.length; i++) {
        const ancestor = dirIndex.get(libraryNodeKey(bucketKey, parts.slice(0, i).join('/')));
        if (ancestor) ancestor.count = (ancestor.count ?? 0) + 1;
      }
    }

    for (const relPath of phantomsByBucket.get(bucketKey) ?? []) {
      ensureDir(relPath.split('/').filter(Boolean));
    }

    const sortNodes = (nodes: LibraryTreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const n of nodes) if (n.children) sortNodes(n.children);
    };
    sortNodes(top);

    roots.push({
      key: bucketKey,
      name: bucket.label,
      kind: 'dir',
      scope: bucket.scope,
      projectId: bucket.projectId,
      relPath: '',
      isBucketRoot: true,
      children: top,
      count: bucket.docs.length
    });
  }

  roots.sort((a, b) => {
    if (a.key === 'global') return -1;
    if (b.key === 'global') return 1;
    return a.name.localeCompare(b.name);
  });
  return roots;
}
