import { ClipboardCopy, Code2, FolderOpen, TerminalSquare } from 'lucide-react';
import type { OpenTarget, Project } from '@zana-ai/zcc-domain/product';
import { product } from '../../lib/product-client.js';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { copyText } from '../../lib/copy-text.js';
import { fileManagerName } from '../../lib/file-manager.js';
import { useUi } from '../../store.js';
import { isRemoteWorkspaceProject } from '../composer-project-default.js';
import { CursorIcon } from '../icons/CursorIcon.js';

/** Both project rails open the registered local checkout through the desktop bridge. */
export function ProjectOpenActions({ project, onClose }: { project: Project; onClose: () => void }) {
  const pushToast = useUi((s) => s.pushToast);
  const open = async (target: OpenTarget) => {
    onClose();
    try {
      const result = await product.openers.openIn(target, project.path);
      if (!result.ok) pushToast(result.message ?? `Failed to open in ${target}`, 'error');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : `Failed to open in ${target}`, 'error');
    }
  };

  return (
    <>
      {hasDesktopBridge() && !isRemoteWorkspaceProject(project) && (
        <>
          <button type="button" className="project-menu-item" onClick={() => void open('cursor')}>
            <CursorIcon size={12} /><span>Open in Cursor</span>
          </button>
          <button type="button" className="project-menu-item" onClick={() => void open('code')}>
            <Code2 size={12} /><span>Open in VS Code</span>
          </button>
          <button type="button" className="project-menu-item" onClick={() => void open('intellij')}>
            <Code2 size={12} /><span>Open in IntelliJ IDEA</span>
          </button>
          <button type="button" className="project-menu-item" onClick={() => void open('finder')}>
            <FolderOpen size={12} /><span>Reveal in {fileManagerName()}</span>
          </button>
          <button type="button" className="project-menu-item" onClick={() => void open('terminal')}>
            <TerminalSquare size={12} /><span>Open in external Terminal</span>
          </button>
        </>
      )}
      <button type="button" className="project-menu-item" onClick={() => {
        onClose();
        void copyText(project.path).then(
          () => pushToast('Path copied', 'info'),
          () => pushToast('Failed to copy path', 'error')
        );
      }}>
        <ClipboardCopy size={12} /><span>Copy path</span>
      </button>
    </>
  );
}
