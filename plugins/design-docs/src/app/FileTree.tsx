import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, FilePlus2, Folder, FolderOpen, Home, MoreHorizontal, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import type { DesignDocDetail, DesignDocFileMeta } from '../shared/contract.js';
import { formatBytes } from '../shared/display.js';
import { MAX_BINARY_FILE_BYTES, MAX_FILES_PER_DOC, MAX_TEXT_FILE_BYTES } from '../shared/limits.js';
import { extensionOf, fileKindOf, isBinaryKind } from '../shared/paths.js';
import { errorMessage, toast, useApi } from './api.js';
import { buildTree, type TreeNode } from './content.js';
import { ConfirmDialog, FileIcon, IconButton, MenuItem, Popover, type ConfirmRequest } from './ui.js';

/** A sensible first draft for a new file, by type. */
export function starterContent(path: string): string {
  const name = path.split('/').at(-1)!.replace(/\.[^.]+$/, '');
  const title = name.replace(/[-_]+/g, ' ').replace(/^\w/, (char) => char.toUpperCase());
  switch (fileKindOf(path)) {
    case 'markdown':
      return `# ${title}\n\n`;
    case 'mermaid':
      return 'flowchart LR\n  A[Start] --> B[Next]\n';
    case 'html':
      return `<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <title>${title}</title>\n</head>\n<body>\n  <h1>${title}</h1>\n</body>\n</html>\n`;
    case 'svg':
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">\n  <rect x="10" y="10" width="180" height="80" rx="8" fill="none" stroke="currentColor"/>\n</svg>\n';
    default:
      return '';
  }
}

/** Default to markdown when the user types a bare name. */
export function withDefaultExtension(raw: string): string {
  const path = raw.trim().replace(/^\/+/, '');
  return extensionOf(path) ? path : `${path}.md`;
}

/** Images and fonts are sent base64-encoded; everything else as text. */
function readUpload(file: File): Promise<{ content: string; encoding?: 'base64' }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const binary = isBinaryKind(fileKindOf(file.name));
    reader.onerror = () => reject(reader.error ?? new Error('could not read the file'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(binary ? { content: result.slice(result.indexOf(',') + 1), encoding: 'base64' } : { content: result });
    };
    if (binary) reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
}

function PathInput({
  initial,
  placeholder,
  onSubmit,
  onCancel
}: {
  initial: string;
  placeholder: string;
  onSubmit(value: string): void;
  onCancel(): void;
}) {
  const [value, setValue] = useState(initial);
  // Enter submits and unmounts; the blur that can follow must not submit twice.
  const done = useRef(false);
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (done.current) return;
    done.current = true;
    if (value.trim() && value.trim() !== initial) onSubmit(value.trim());
    else onCancel();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      done.current = true;
      onCancel();
    }
  };
  return (
    <form className="dd-tree-input" onSubmit={submit}>
      <input
        className="dd-input"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => submit()}
        autoFocus
        onFocus={(event) => {
          const dot = event.target.value.lastIndexOf('.');
          const slash = event.target.value.lastIndexOf('/') + 1;
          event.target.setSelectionRange(slash, dot > slash ? dot : event.target.value.length);
        }}
      />
    </form>
  );
}

function FileRow({
  doc,
  file,
  name,
  depth,
  active,
  renaming,
  onOpen,
  onRename,
  onRenameDone,
  onDelete
}: {
  doc: DesignDocDetail;
  file: DesignDocFileMeta;
  name: string;
  depth: number;
  active: boolean;
  renaming: boolean;
  onOpen(): void;
  onRename(): void;
  onRenameDone(to: string | null): void;
  onDelete(): void;
}) {
  const api = useApi();
  const [menu, setMenu] = useState(false);
  const isEntry = doc.entryPath === file.path;
  const commentCount = doc.comments.filter((comment) => comment.status === 'open' && comment.path === file.path).length;
  if (renaming) {
    return (
      <div className="dd-tree-row" style={{ paddingLeft: 8 + depth * 14 }}>
        <PathInput initial={file.path} placeholder="New path" onSubmit={(to) => onRenameDone(to)} onCancel={() => onRenameDone(null)} />
      </div>
    );
  }
  return (
    <div className={`dd-tree-row dd-tree-file${active ? ' on' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}>
      <button
        type="button"
        className="dd-tree-open"
        onClick={onOpen}
        onDoubleClick={onRename}
        title={`${file.path} · ${formatBytes(file.size)} · rev ${file.revision}`}
        aria-current={active ? 'page' : undefined}
      >
        <FileIcon kind={file.kind} />
        <span className="dd-tree-name">{name}</span>
        {isEntry ? <Home size={11} className="dd-tree-entry" aria-label="Entry file" /> : null}
        {commentCount ? <span className="dd-tree-badge" title={`${commentCount} open comment${commentCount === 1 ? '' : 's'}`}>{commentCount}</span> : null}
      </button>
      <Popover
        open={menu}
        onClose={() => setMenu(false)}
        className="dd-menu"
        anchor={<IconButton icon={MoreHorizontal} label={`Actions for ${file.path}`} size={13} active={menu} onClick={() => setMenu(!menu)} />}
      >
        <MenuItem
          icon={Pencil}
          label="Rename or move"
          onSelect={() => {
            setMenu(false);
            onRename();
          }}
        />
        {isEntry || isBinaryKind(file.kind) ? null : (
          <MenuItem
            icon={Star}
            label="Open first"
            hint="Make this the doc's entry file"
            onSelect={() => {
              setMenu(false);
              void api.update(doc.id, { entryPath: file.path }).catch((error: unknown) => toast(errorMessage(error), 'error'));
            }}
          />
        )}
        <MenuItem
          icon={Trash2}
          label="Delete"
          danger
          onSelect={() => {
            setMenu(false);
            onDelete();
          }}
        />
      </Popover>
    </div>
  );
}

export function FileTree({
  doc,
  activePath,
  onOpen,
  onPathChanged,
  hasDraft
}: {
  doc: DesignDocDetail;
  activePath: string | null;
  onOpen(path: string): void;
  /** A file the user is looking at moved or disappeared. */
  onPathChanged(from: string, to: string | null): void;
  /** Whether `path` has unsaved edits open, so renaming or deleting it asks first. */
  hasDraft?(path: string): boolean;
}) {
  const api = useApi();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const tree = buildTree(doc.files);
  const full = doc.files.length >= MAX_FILES_PER_DOC;
  const folderOfActive = activePath?.includes('/') ? activePath.slice(0, activePath.lastIndexOf('/') + 1) : '';

  const create = async (raw: string) => {
    setCreating(false);
    const path = withDefaultExtension(raw);
    if (doc.files.some((file) => file.path === path)) {
      onOpen(path);
      return;
    }
    if (isBinaryKind(fileKindOf(path))) {
      toast('Use “Add files” to upload images and fonts.', 'error');
      return;
    }
    try {
      await api.writeFile(doc.id, { path, content: starterContent(path) });
      onOpen(path);
    } catch (error) {
      toast(`Could not create ${path}: ${errorMessage(error)}`, 'error');
    }
  };

  const rename = (from: string, to: string | null) => {
    setRenaming(null);
    if (!to || to === from) return;
    const run = async () => {
      try {
        const result = await api.renameFile(doc.id, from, to);
        onPathChanged(from, result.path);
      } catch (error) {
        toast(`Could not rename ${from}: ${errorMessage(error)}`, 'error');
      }
    };
    if (!hasDraft?.(from)) {
      void run();
      return;
    }
    setConfirm({
      title: 'Discard unsaved changes?',
      body: (
        <>
          Renaming <code>{from}</code> drops your unsaved edits to it. Save them first to keep them.
        </>
      ),
      confirmLabel: 'Discard and rename',
      danger: true,
      run
    });
  };

  const upload = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      const kind = fileKindOf(file.name);
      const limit = isBinaryKind(kind) ? MAX_BINARY_FILE_BYTES : MAX_TEXT_FILE_BYTES;
      if (file.size > limit) {
        toast(`${file.name} is larger than ${formatBytes(limit)}`, 'error');
        continue;
      }
      const asset = kind === 'image' || kind === 'svg' || kind === 'font';
      const path = `${folderOfActive || (asset ? 'assets/' : '')}${file.name.replace(/[^\w.-]+/g, '-')}`;
      try {
        const body = await readUpload(file);
        await api.writeFile(doc.id, { path, ...body });
        const relative = path.slice(folderOfActive.length);
        toast(kind === 'font' || !asset ? `Added ${path}` : `Added ${path}. Reference it with ![${file.name}](${relative})`);
      } catch (error) {
        toast(`Could not add ${file.name}: ${errorMessage(error)}`, 'error');
      }
    }
    if (uploadRef.current) uploadRef.current.value = '';
  };

  const askDelete = (file: DesignDocFileMeta) =>
    setConfirm({
      title: 'Delete file',
      body: (
        <>
          Delete <code>{file.path}</code>? Its history is kept, so it can be recreated from History.
          {hasDraft?.(file.path) ? ' Your unsaved edits to it will be lost.' : null}
        </>
      ),
      confirmLabel: 'Delete',
      danger: true,
      run: async () => {
        try {
          await api.deleteFile(doc.id, file.path);
          onPathChanged(file.path, null);
        } catch (error) {
          toast(`Could not delete ${file.path}: ${errorMessage(error)}`, 'error');
        }
      }
    });

  const toggle = (path: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const render = (nodes: Array<TreeNode<DesignDocFileMeta>>, depth: number) =>
    nodes.map((node) => {
      if (node.kind === 'folder') {
        const open = !collapsed.has(node.path);
        return (
          <div key={`d:${node.path}`} role="group" aria-label={node.name}>
            <button type="button" className="dd-tree-row dd-tree-folder" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => toggle(node.path)} aria-expanded={open}>
              {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
              {open ? <FolderOpen size={14} aria-hidden /> : <Folder size={14} aria-hidden />}
              <span className="dd-tree-name">{node.name}</span>
            </button>
            {open ? render(node.children as Array<TreeNode<DesignDocFileMeta>>, depth + 1) : null}
          </div>
        );
      }
      return (
        <FileRow
          key={`f:${node.path}`}
          doc={doc}
          file={node.file}
          name={node.name}
          depth={depth}
          active={node.path === activePath}
          renaming={renaming === node.path}
          onOpen={() => onOpen(node.path)}
          onRename={() => setRenaming(node.path)}
          onRenameDone={(to) => void rename(node.path, to)}
          onDelete={() => askDelete(node.file)}
        />
      );
    });

  return (
    <nav className="dd-tree" aria-label="Files">
      <div className="dd-tree-head">
        <span className="dd-section-label">Files</span>
        <span className="dd-tree-count">{doc.files.length}</span>
        <span className="dd-spacer" />
        <IconButton icon={FilePlus2} label="Add files" size={13} disabled={full} onClick={() => uploadRef.current?.click()} />
        <IconButton icon={Plus} label="New file" size={13} disabled={full} onClick={() => setCreating(true)} />
        <input
          ref={uploadRef}
          type="file"
          multiple
          hidden
          onChange={(event) => void upload(event.target.files)}
        />
      </div>
      <div className="dd-tree-scroll" role="tree">
        {render(tree, 0)}
        {creating ? (
          <div className="dd-tree-row" style={{ paddingLeft: 8 }}>
            <PathInput
              initial={folderOfActive}
              placeholder="path/name.md, .mmd, .html…"
              onSubmit={(path) => void create(path)}
              onCancel={() => setCreating(false)}
            />
          </div>
        ) : null}
      </div>
      {confirm ? <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} /> : null}
    </nav>
  );
}
