import { useEffect, useRef, useState } from 'react';
import { Download, FileArchive, FileText, FolderOpen, Package } from 'lucide-react';
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

export function FilePreviewRevealButton({ state }: { state: FilePreviewRevealState }) {
  if (!state.available) return null;
  return (
    <button type="button" className="thread-file-preview-reveal"
      title="Open the containing folder with this file selected" disabled={state.busy}
      aria-busy={state.busy} onClick={() => { void state.reveal(); }}>
      <FolderOpen size={14} aria-hidden />
      {state.label}
    </button>
  );
}

export function binaryPreviewKind(path: string): { label: string; extension: string; archive: boolean } | null {
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
    archive: ['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar'].includes(extension) };
}

function downloadError(status?: number): string {
  if (status === 403) return 'This file is outside the preview’s allowed folders.';
  if (status === 404) return 'The file may have been moved or deleted.';
  if (status === 503) return 'The file host is unavailable. Reconnect and try again.';
  return 'Could not start the download. Try again.';
}

function FilePreviewDownload({ url, reveal }: { url: string; reveal?: FilePreviewRevealState }) {
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function download() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(null);
    try {
      // Check availability without pulling the file into renderer memory.
      // The browser handles the actual transfer, progress and save location.
      const response = await fetch(url, { method: 'HEAD', signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setError(downloadError(response.status));
        return;
      }
      const link = document.createElement('a');
      link.href = url;
      link.download = '';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      if (!controller.signal.aborted) setError(downloadError());
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <>
      <div className="thread-file-preview-file-actions">
        <button type="button" className="thread-file-preview-reveal is-primary"
          disabled={busy} aria-busy={busy} onClick={() => { void download(); }}>
          <Download size={14} aria-hidden />
          {busy ? 'Preparing download…' : 'Download file'}
        </button>
        {reveal ? <FilePreviewRevealButton state={reveal} /> : null}
      </div>
      {error ? <p className="thread-file-preview-download-error" role="alert">{error}</p> : null}
    </>
  );
}

export function FilePreviewFallback({ path, threadId, projectId, storage = false, tooLarge = false, reveal }: {
  path: string; threadId?: string; projectId?: string | null; storage?: boolean;
  tooLarge?: boolean; reveal?: FilePreviewRevealState;
}) {
  const kind = binaryPreviewKind(path);
  const Icon = tooLarge ? FileText : kind?.archive ? FileArchive : Package;
  const params = new URLSearchParams({ path, source: storage ? 'thread-storage' : 'workspace' });
  if (threadId) params.set('threadId', threadId);
  if (projectId) params.set('projectId', projectId);
  const url = `/api/v1/file-preview/download?${params}`;
  return (
    <div className="thread-file-preview-fallback" role="status">
      <div className="thread-file-preview-file-art"><Icon size={32} strokeWidth={1.4} aria-hidden />
        {kind && !tooLarge ? <span>{kind.extension}</span> : null}</div>
      <h2>{previewPathParts(path).name}</h2>
      {kind ? <p className="thread-file-preview-file-kind">{kind.label}</p> : null}
      {tooLarge ? <h3>This file is too large to preview.</h3> : null}
      <FilePreviewDownload key={url} url={url} reveal={reveal} />
    </div>
  );
}
