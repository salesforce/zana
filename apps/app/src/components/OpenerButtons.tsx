import { product } from '../lib/product-client.js';
import { Code2, FolderOpen, TerminalSquare } from 'lucide-react';
import type { OpenTarget } from '@zana-ai/zcc-domain/product';
import { useData, useUi } from '../store.js';
import { CursorIcon } from './icons/CursorIcon.js';
import { IntelliJIcon } from './icons/IntelliJIcon.js';

interface Props {
  path: string;
  /**
   * Path handed to editor targets (Cursor / VS Code) instead of `path`. Use it
   * to open the whole project/source root in the editor rather than the single
   * file under the cursor. Finder/terminal still act on `path`. Falls back to
   * `path` when omitted.
   */
  editorPath?: string;
  size?: number;
  className?: string;
}

const EDITOR_TARGETS = new Set<OpenTarget>(['cursor', 'code', 'intellij']);

// Each target carries a render function so Lucide icons (typed via
// LucideIcon, which uses string|number for `size`) and our CursorIcon (a
// plain functional component) can coexist without a fragile shared type.
const TARGETS: Array<{
  key: OpenTarget;
  label: string;
  render: (size: number) => React.ReactElement;
}> = [
  { key: 'cursor', label: 'Open in Cursor', render: (s) => <CursorIcon size={s} /> },
  { key: 'code', label: 'Open in VS Code', render: (s) => <Code2 size={s} /> },
  { key: 'intellij', label: 'Open in IntelliJ IDEA', render: (s) => <IntelliJIcon size={s} /> },
  { key: 'finder', label: 'Reveal in Finder', render: (s) => <FolderOpen size={s} /> },
  { key: 'terminal', label: 'Open external Terminal', render: (s) => <TerminalSquare size={s} /> }
];

export function OpenerButtons({ path, editorPath, size = 14, className }: Props) {
  const pushToast = useUi((s) => s.pushToast);
  // Targets the user hid in Settings → Editor are dropped from every opener bar.
  const hidden = useData((s) => s.openerHiddenTargets);

  const onClick = async (target: OpenTarget) => {
    const dest = EDITOR_TARGETS.has(target) ? editorPath ?? path : path;
    const r = await product.openers.openIn(target, dest);
    if (!r.ok) pushToast(r.message ?? `Failed to open in ${target}`, 'error');
  };

  const visible = TARGETS.filter(({ key }) => !hidden.includes(key));

  return (
    <div className={`opener-bar ${className ?? ''}`}>
      {visible.map(({ key, label, render }) => (
        <button
          key={key}
          type="button"
          className="opener-btn"
          title={label}
          onClick={(e) => {
            e.stopPropagation();
            onClick(key);
          }}
        >
          {render(size)}
        </button>
      ))}
    </div>
  );
}
