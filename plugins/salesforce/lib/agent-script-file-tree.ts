export interface AgentScriptTreeFile {
  kind: 'file';
  name: string;
  path: string;
  apiName: string;
  lines: number;
}

export interface AgentScriptTreeFolder {
  kind: 'folder';
  name: string;
  path: string;
  children: AgentScriptTreeNode[];
}

export type AgentScriptTreeNode = AgentScriptTreeFile | AgentScriptTreeFolder;

export interface AgentScriptTreeSource {
  apiName: string;
  path: string;
  lines: number;
}

function sortNodes(nodes: AgentScriptTreeNode[]): AgentScriptTreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function buildAgentScriptFileTree(files: readonly AgentScriptTreeSource[]): AgentScriptTreeNode[] {
  type DraftFolder = { kind: 'folder'; name: string; path: string; children: Map<string, Draft> };
  type Draft = DraftFolder | AgentScriptTreeFile;
  const root: DraftFolder = { kind: 'folder', name: '', path: '', children: new Map() };

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    if (parts.length === 0) continue;
    let cursor = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const name = parts[i]!;
      const path = parts.slice(0, i + 1).join('/');
      let next = cursor.children.get(name);
      if (!next || next.kind !== 'folder') {
        next = { kind: 'folder', name, path, children: new Map() };
        cursor.children.set(name, next);
      }
      cursor = next;
    }
    const name = parts[parts.length - 1]!;
    cursor.children.set(name, {
      kind: 'file',
      name,
      path: file.path,
      apiName: file.apiName,
      lines: file.lines
    });
  }

  const freeze = (folder: DraftFolder): AgentScriptTreeNode[] =>
    sortNodes(
      [...folder.children.values()].map((child) =>
        child.kind === 'folder'
          ? { kind: 'folder', name: child.name, path: child.path, children: freeze(child) }
          : child
      )
    );

  return freeze(root);
}

export function ancestorFolderPaths(filePath: string): string[] {
  const parts = filePath.split('/').filter(Boolean);
  if (parts.length <= 1) return [];
  const folders: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    folders.push(parts.slice(0, i).join('/'));
  }
  return folders;
}

export function breadcrumbSegments(path: string | null, exampleTitle?: string): string[] {
  if (!path) return exampleTitle ? [exampleTitle] : [];
  return path.split('/').filter(Boolean);
}

export function filterAgentScriptFileTree(
  nodes: readonly AgentScriptTreeNode[],
  query: string
): AgentScriptTreeNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...nodes];

  const visit = (node: AgentScriptTreeNode): AgentScriptTreeNode | null => {
    if (node.kind === 'file') {
      const haystack = `${node.name} ${node.apiName} ${node.path}`.toLowerCase();
      return haystack.includes(needle) ? node : null;
    }
    const children = node.children.map(visit).filter((child): child is AgentScriptTreeNode => child !== null);
    if (children.length > 0 || node.name.toLowerCase().includes(needle)) {
      return { ...node, children };
    }
    return null;
  };

  return nodes.map(visit).filter((node): node is AgentScriptTreeNode => node !== null);
}

export function defaultExpandedFolders(
  files: readonly AgentScriptTreeSource[],
  activePath: string | null
): string[] {
  const expanded = new Set<string>();
  for (const file of files) {
    for (const folder of ancestorFolderPaths(file.path)) {
      if (folder.split('/').length <= 2) expanded.add(folder);
    }
  }
  if (activePath) {
    for (const folder of ancestorFolderPaths(activePath)) expanded.add(folder);
  }
  return [...expanded];
}
