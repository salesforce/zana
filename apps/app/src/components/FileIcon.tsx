import { FileText, Folder, FolderOpen } from 'lucide-react';
import { useData } from '@/store';
import { resolveFileIcon } from '../lib/fileIcons/resolveFileIcon.js';
import '../lib/fileIcons/seti.generated.css';

interface IconProps {
  size?: number;
}

/** Seti glyphs fill more of the em box than lucide strokes do, so scale them up to match. */
const SETI_SCALE = 1.25;

/**
 * Icon for a file row, per the `explorerFileIconTheme` setting: a Seti
 * (VS Code) glyph chosen by name, one plain glyph, or nothing. Pass the file
 * name or a path.
 */
export function FileIcon({ name, size = 13 }: IconProps & { name: string }) {
  const theme = useData((s) => s.explorerFileIconTheme);
  if (theme === 'none') return null;
  if (theme === 'minimal') return <FileText size={size} aria-hidden="true" />;
  const { id, char } = resolveFileIcon(name);
  return (
    <span className={`file-icon seti-${id}`} style={{ fontSize: size * SETI_SCALE }} aria-hidden="true">
      {char}
    </span>
  );
}

/** Folder glyph for tree rows. */
export function FolderIcon({ open = false, size = 13 }: IconProps & { open?: boolean }) {
  const theme = useData((s) => s.explorerFileIconTheme);
  if (theme === 'none') return null;
  return open ? <FolderOpen size={size} aria-hidden="true" /> : <Folder size={size} aria-hidden="true" />;
}
