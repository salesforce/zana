import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type MutableRefObject } from 'react';
import { Markdown } from '@zana-ai/zcc-plugin-sdk/app';
import { MessageSquarePlus, Monitor, Smartphone, Sparkles, Tablet } from 'lucide-react';
import type { DesignDocFileMeta } from '../shared/contract.js';
import { MAX_QUOTE_LENGTH } from '../shared/limits.js';
import type { FileKind } from '../shared/paths.js';
import { toast, useApi } from './api.js';
import {
  codeFence,
  fenced,
  fileDataUrl,
  inlineImages,
  readThemeTokens,
  referencedImages,
  resolveDocLink,
  themedHtml
} from './content.js';
import { COMMENT_HIGHLIGHT, FOCUS_HIGHLIGHT, findQuoteRanges, paintRanges } from './highlight.js';

export interface PreviewFile {
  path: string;
  kind: FileKind;
  content: string;
  encoding: 'utf8' | 'base64';
}

export interface PreviewHandle {
  /** Scroll to and flash a quoted passage; false when it is not on screen. */
  focusQuote(quote: string): boolean;
}

const MAX_INLINE_IMAGES = 24;
const ASSET_CACHE_LIMIT = 64;
const assetCache = new Map<string, string>();

function rememberAsset(key: string, url: string) {
  assetCache.delete(key);
  assetCache.set(key, url);
  while (assetCache.size > ASSET_CACHE_LIMIT) assetCache.delete(assetCache.keys().next().value!);
}

/** Data URLs for the doc images a markdown/HTML file references, keyed by path. */
export function useImageAssets(docId: string, files: readonly DesignDocFileMeta[], paths: readonly string[]): ReadonlyMap<string, string> {
  const api = useApi();
  const wanted = useMemo(() => {
    const byPath = new Map(files.map((file) => [file.path, file]));
    return paths
      .map((path) => byPath.get(path))
      .filter((file): file is DesignDocFileMeta => !!file && (file.kind === 'image' || file.kind === 'svg'))
      .slice(0, MAX_INLINE_IMAGES);
  }, [files, paths]);
  const signature = wanted.map((file) => `${file.path}@${file.revision}`).join('|');
  const wantedRef = useRef(wanted);
  wantedRef.current = wanted;
  const [assets, setAssets] = useState<ReadonlyMap<string, string>>(new Map());

  // `signature` captures everything about `wanted` that changes the result.
  useEffect(() => {
    const wanted = wantedRef.current;
    let cancelled = false;
    const next = new Map<string, string>();
    const missing: DesignDocFileMeta[] = [];
    for (const file of wanted) {
      const cached = assetCache.get(`${docId}\u0000${file.path}\u0000${file.revision}`);
      if (cached) next.set(file.path, cached);
      else missing.push(file);
    }
    setAssets(next);
    if (!missing.length) return;
    void Promise.all(
      missing.map(async (meta) => {
        try {
          const file = await api.readFile(docId, meta.path);
          const url = fileDataUrl(file);
          if (url) {
            rememberAsset(`${docId}\u0000${file.path}\u0000${file.revision}`, url);
            next.set(file.path, url);
          }
        } catch {
          // A missing image renders as its alt text, like a broken link would.
        }
      })
    ).then(() => {
      if (!cancelled) setAssets(new Map(next));
    });
    return () => {
      cancelled = true;
    };
  }, [api, docId, signature]);
  return assets;
}

const FRAME_WIDTHS = [
  { id: 'full', label: 'Full width', icon: Monitor, width: null },
  { id: 'tablet', label: 'Tablet (768px)', icon: Tablet, width: 768 },
  { id: 'phone', label: 'Phone (390px)', icon: Smartphone, width: 390 }
] as const;

function HtmlFrame({ file, assets }: { file: PreviewFile; assets: ReadonlyMap<string, string> }) {
  const [width, setWidth] = useState<(typeof FRAME_WIDTHS)[number]['id']>('full');
  const srcDoc = useMemo(
    () => themedHtml(inlineImages(file.path, file.content, 'html', assets), readThemeTokens()),
    [file.path, file.content, assets]
  );
  const frameWidth = FRAME_WIDTHS.find((option) => option.id === width)!.width;
  return (
    <div className="dd-html-stage">
      <div className="dd-html-toolbar" role="toolbar" aria-label="Preview width">
        {FRAME_WIDTHS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`icon-btn${width === option.id ? ' on' : ''}`}
            title={option.label}
            aria-label={option.label}
            aria-pressed={width === option.id}
            onClick={() => setWidth(option.id)}
          >
            <option.icon size={14} aria-hidden />
          </button>
        ))}
      </div>
      <div className="dd-html-viewport">
        <iframe
          className={`dd-html-frame${frameWidth ? ' dd-html-frame-device' : ''}`}
          style={frameWidth ? { width: frameWidth } : undefined}
          // Scripts may run (interactive mockups) but the frame keeps an opaque
          // origin: no same-origin, forms, popups or top navigation.
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          title={file.path}
        />
      </div>
    </div>
  );
}

interface SelectionChip {
  text: string;
  top: number;
  left: number;
}

export function FilePreview({
  docId,
  file,
  files,
  quotes = [],
  onOpenPath,
  onQuote,
  onAskAbout,
  handleRef
}: {
  docId: string;
  file: PreviewFile;
  files: readonly DesignDocFileMeta[];
  /** Open comment quotes to highlight in this file. */
  quotes?: readonly string[];
  onOpenPath?(path: string): void;
  onQuote?(text: string): void;
  onAskAbout?(text: string): void;
  handleRef?: MutableRefObject<PreviewHandle | null>;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const owner = useRef({});
  const [chip, setChip] = useState<SelectionChip | null>(null);
  const textual = file.kind === 'markdown' || file.kind === 'html';
  const imagePaths = useMemo(
    () => (textual ? referencedImages(file.path, file.content, file.kind as 'markdown' | 'html') : []),
    [textual, file.path, file.content, file.kind]
  );
  const assets = useImageAssets(docId, files, imagePaths);
  const known = useMemo(() => new Set(files.map((entry) => entry.path)), [files]);

  const markdown = useMemo(() => {
    if (file.kind === 'markdown') return inlineImages(file.path, file.content, 'markdown', assets);
    if (file.kind === 'mermaid') return fenced(file.content, 'mermaid');
    if (file.kind === 'code') return codeFence(file.path, file.content);
    return null;
  }, [file.kind, file.path, file.content, assets]);

  // Paint open-comment quotes after the host renderer (and mermaid) settle.
  const quoteKey = quotes.join('\u0000');
  useEffect(() => {
    const root = contentRef.current;
    const self = owner.current;
    const quotes = quoteKey ? quoteKey.split('\u0000') : [];
    if (!root || !quotes.length) {
      paintRanges(COMMENT_HIGHLIGHT, self, []);
      return;
    }
    const paint = () => paintRanges(COMMENT_HIGHLIGHT, self, [...findQuoteRanges(root, quotes).values()]);
    const timer = setTimeout(paint, 60);
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(() => paint()) : null;
    observer?.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      clearTimeout(timer);
      observer?.disconnect();
      paintRanges(COMMENT_HIGHLIGHT, self, []);
      paintRanges(FOCUS_HIGHLIGHT, self, []);
    };
  }, [quoteKey, markdown, file.kind, file.content]);

  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      focusQuote(quote) {
        const root = contentRef.current;
        const range = root ? findQuoteRanges(root, [quote]).get(quote) : undefined;
        if (!range) return false;
        const target = range.startContainer.parentElement;
        target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        paintRanges(FOCUS_HIGHLIGHT, owner.current, [range]);
        setTimeout(() => paintRanges(FOCUS_HIGHLIGHT, owner.current, []), 1800);
        return true;
      }
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef]);

  const onClickCapture = (event: ReactMouseEvent) => {
    const anchor = (event.target as Element | null)?.closest?.('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const target = resolveDocLink(file.path, href);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const folderEntry = [...known].find((path) => path.startsWith(`${target}/`));
    if (known.has(target)) onOpenPath?.(target);
    else if (folderEntry) onOpenPath?.(folderEntry);
    else toast(`${target} is not a file in this design doc`, 'error');
  };

  const onMouseUp = () => {
    if (!onQuote) return;
    const selection = globalThis.getSelection?.();
    const scroller = scrollRef.current;
    const text = selection?.toString().trim() ?? '';
    if (!selection || selection.isCollapsed || !text || !scroller || !contentRef.current?.contains(selection.anchorNode)) {
      setChip(null);
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    setChip({
      text: text.slice(0, MAX_QUOTE_LENGTH),
      top: Math.max(4, rect.top - box.top + scroller.scrollTop - 36),
      left: Math.min(Math.max(80, rect.left - box.left + rect.width / 2), Math.max(80, box.width - 80))
    });
  };

  const applyChip = (handler: ((text: string) => void) | undefined) => {
    if (!chip || !handler) return;
    handler(chip.text);
    setChip(null);
    globalThis.getSelection?.()?.removeAllRanges();
  };

  let body;
  if (file.kind === 'html') {
    body = <HtmlFrame file={file} assets={assets} />;
  } else if (file.kind === 'image' || file.kind === 'svg') {
    const url = fileDataUrl(file);
    body = (
      <div className="dd-image-stage">
        {url ? <img src={url} alt={file.path} /> : <span className="dd-muted">This image cannot be displayed.</span>}
      </div>
    );
  } else if (markdown !== null) {
    body = (
      <div className={`dd-prose dd-prose-${file.kind}`} ref={contentRef} onClickCapture={onClickCapture}>
        {file.kind === 'markdown' && !file.content.trim() ? (
          <p className="dd-muted">This file is empty. Switch to Edit, or ask an agent to fill it in.</p>
        ) : (
          <Markdown content={markdown} />
        )}
      </div>
    );
  } else {
    body = (
      <div className="dd-prose" ref={contentRef}>
        <pre className="dd-plain">{file.content}</pre>
      </div>
    );
  }

  return (
    <div
      className={`dd-preview dd-preview-${file.kind}`}
      ref={scrollRef}
      onMouseUp={onMouseUp}
      onMouseDown={(event) => {
        if (!(event.target as Element).closest?.('.dd-selection-chip')) setChip(null);
      }}
    >
      {body}
      {chip ? (
        <div className="dd-selection-chip" style={{ top: chip.top, left: chip.left }}>
          <button type="button" onClick={() => applyChip(onQuote)}>
            <MessageSquarePlus size={13} aria-hidden />
            Comment
          </button>
          {onAskAbout ? (
            <button type="button" onClick={() => applyChip(onAskAbout)}>
              <Sparkles size={13} aria-hidden />
              Ask agent
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
