import { useEffect, useRef, useState } from 'react';
import { FileArchive, FileText, FolderOpen, Package } from 'lucide-react';
import type { CcApi } from '@zana-ai/zcc-desktop-contract';
import { hasDesktopBridge } from '../../../lib/app-surface.js';
import { fileManagerName } from '../../../lib/file-manager.js';
import { product } from '../../../lib/product-client.js';
import { previewPathParts } from './threadSecondaryPanelLogic.js';

type Request = Parameters<CcApi['openers']['fileLocation']>[0];
export interface FilePreviewRevealState {
  available: boolean;
  busy: boolean;
  error: string | null;
  label: string;
  reveal(): Promise<void>;
}

export function useFilePreviewReveal(input: Request, revision = 0): FilePreviewRevealState {
  const scope = JSON.stringify(input);
  const activeScope = useRef<string | null>(scope);
  const [state, setState] = useState({ scope, available: false, busy: false, error: null as string | null });
  useEffect(() => {
    let cancelled = false;
    activeScope.current = scope;
    if (hasDesktopBridge()) {
      void product.openers.fileLocation(JSON.parse(scope)).then(result => {
        if (!cancelled) setState({ scope, available: result.ok, busy: false, error: null });
      }).catch(() => {
        if (!cancelled) setState({ scope, available: false, busy: false, error: null });
      });
    }
    return () => { cancelled = true; activeScope.current = null; };
  }, [scope, revision]);
  const current = state.scope === scope ? state : { available: false, busy: false, error: null };
  return {
    ...current,
    label: `Show in ${fileManagerName()}`,
    reveal: async () => {
      if (!current.available || current.busy) return;
      setState({ scope, available: true, busy: true, error: null });
      try {
        const result = await product.openers.revealFile(input);
        if (activeScope.current === scope) setState({ scope, available: true, busy: false,
          error: result.ok ? null : result.message ?? 'Could not show this file in its folder.' });
      } catch {
        if (activeScope.current === scope) setState({ scope, available: true, busy: false,
          error: 'Could not show this file in its folder. Try again.' });
      }
    }
  };
}

export function FilePreviewRevealButton({ state, primary = false }: { state: FilePreviewRevealState; primary?: boolean }) {
  if (!state.available) return null;
  return (
    <button type="button" className={`thread-file-preview-reveal${primary ? ' is-primary' : ''}`}
      title="Open the containing folder with this file selected" disabled={state.busy}
      aria-busy={state.busy} onClick={() => { void state.reveal(); }}>
      <FolderOpen size={14} aria-hidden />
      {state.label}
    </button>
  );
}

export function binaryPreviewKind(path: string): { label: string; extension: string; archive: boolean; installer: boolean } | null {
  const extension = path.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (!extension) return null;
  const labels: Record<string, string> = {
    dmg: 'macOS disk image', pkg: 'macOS installer', exe: 'Windows application', msi: 'Windows installer',
    deb: 'Debian package', rpm: 'RPM package', appimage: 'Linux application', iso: 'Disk image',
    zip: 'ZIP archive', tar: 'TAR archive', gz: 'Gzip archive', tgz: 'Tar archive', bz2: 'Bzip2 archive',
    xz: 'XZ archive', '7z': '7-Zip archive', rar: 'RAR archive',
    bin: 'Binary file', dll: 'Windows library', dylib: 'macOS library', so: 'Shared library', wasm: 'WebAssembly binary'
  };
  if (!Object.hasOwn(labels, extension)) return null;
  return { label: labels[extension], extension: extension.toUpperCase(),
    archive: ['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar'].includes(extension),
    installer: ['dmg', 'pkg', 'msi', 'deb', 'rpm', 'appimage', 'exe'].includes(extension) };
}

export function FilePreviewFallback({ path, tooLarge = false, reveal }: {
  path: string; tooLarge?: boolean; reveal?: FilePreviewRevealState;
}) {
  const kind = binaryPreviewKind(path);
  const Icon = tooLarge ? FileText : kind?.archive ? FileArchive : Package;
  const manager = fileManagerName();
  return (
    <div className="thread-file-preview-fallback" role="status">
      <div className="thread-file-preview-file-art"><Icon size={32} strokeWidth={1.4} aria-hidden />
        {kind && !tooLarge ? <span>{kind.extension}</span> : null}</div>
      <h2>{previewPathParts(path).name}</h2>
      {kind ? <p className="thread-file-preview-file-kind">{kind.label}</p> : null}
      <h3>{tooLarge ? 'This file is too large to preview.' : 'This file opens outside the preview.'}</h3>
      <p>{reveal?.available
        ? tooLarge
          ? `Find it in ${manager} to open it in an app that can handle larger files.`
          : `Find it in ${manager}, then open it${kind?.installer ? ' to get started' : ' in another app'}.`
        : 'Copy its path from the header to open it on the computer where it is stored.'}</p>
      {reveal?.available ? <><FilePreviewRevealButton state={reveal} primary />
        <p className="thread-file-preview-file-hint">Opens the folder with this file selected.</p></> : null}
    </div>
  );
}
