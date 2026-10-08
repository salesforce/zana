/**
 * An HTML page of a design doc, shown the way the published site will show
 * it. The server bundles the page (`renderPage`); the frame runs it with the
 * page runtime, which talks to this component over a private port: the
 * page's fetches come back here as reads of its own doc, links open doc files
 * in the pane, and selections become comments.
 *
 * The page runs the doc's scripts, so everything it sends is untrusted:
 * messages are parsed and bounded, it can only read files of its own doc, and
 * it opens web links only from a click.
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { AlertTriangle, CornerDownRight, ExternalLink, MessageSquarePlus, Monitor, Smartphone, Sparkles, Tablet, X } from 'lucide-react';
import type { DesignDocFileMeta } from '../shared/contract.js';
import {
  isPageHello,
  MAX_PAGE_PROBLEMS,
  PAGE_CONFIG_ID,
  parseFromPage,
  type FromPage,
  type PageConfig,
  type PageFile,
  type PageProblem,
  type PageRect,
  type ToPage
} from '../shared/frame-protocol.js';
import { escapeAttribute, prependToHead } from '../shared/html-scan.js';
import { MAX_FILES_PER_DOC } from '../shared/limits.js';
import { MAX_RPC_PAYLOAD_BYTES, renderIsStale, scriptJson, withFetched, type PageRenderReport, type RenderedPage } from '../shared/page.js';
import { errorMessage, toast, useApi } from './api.js';
import { readThemeTokens, themedHtml } from './content.js';
import type { PreviewFile, PreviewHandle } from './FilePreview.js';
import { IconButton, Popover, Spinner } from './ui.js';

/** Shipped beside the bundled `app.js`, which is what `import.meta.url` names at runtime. */
const RUNTIME_URL = new URL('./page-runtime.js', import.meta.url).href;

const FRAME_WIDTHS = [
  { id: 'full', label: 'Full width', icon: Monitor, width: null },
  { id: 'tablet', label: 'Tablet (768px)', icon: Tablet, width: 768 },
  { id: 'phone', label: 'Phone (390px)', icon: Smartphone, width: 390 }
] as const;

/** Typing in the editor re-renders the page once it pauses this long. */
export const DRAFT_DELAY_MS = 400;
/** Quiet time after the page's last problem before the panel reports what it saw. */
export const REPORT_DELAY_MS = 1500;
const MAX_FETCHES_ACTIVE = 6;
const MAX_FETCHES_QUEUED = 200;
const MAX_STORAGE_DOCS = 20;
const MAX_PENDING_HASHES = 50;

const PROBLEM_LABELS: Record<PageProblem['kind'], string> = { error: 'Error', missing: 'Missing', blocked: 'Blocked' };

// ── State that outlives one frame ─────────────────────────────────────────

/** `localStorage` each doc's pages wrote: one site, one origin, kept across re-renders. */
const docStorage = new Map<string, Record<string, string>>();

function rememberStorage(docId: string, entries: Record<string, string>) {
  docStorage.delete(docId);
  docStorage.set(docId, entries);
  while (docStorage.size > MAX_STORAGE_DOCS) docStorage.delete(docStorage.keys().next().value!);
}

/** The fragment a link asked for, read by the page it opens. */
const pendingHashes = new Map<string, string>();
const hashKey = (docId: string, path: string) => `${docId}\u0000${path}`;

function rememberHash(docId: string, path: string, hash: string) {
  const key = hashKey(docId, path);
  pendingHashes.delete(key);
  pendingHashes.set(key, hash);
  while (pendingHashes.size > MAX_PENDING_HASHES) pendingHashes.delete(pendingHashes.keys().next().value!);
}

/** Test-only: forget storage and pending fragments. */
export function resetPageFrameState() {
  docStorage.clear();
  pendingHashes.clear();
}

// ── Pure helpers ──────────────────────────────────────────────────────────

/** The frame document: the bundled page, booted by the runtime, themed when it brings no CSS. */
export function pageSrcDoc(page: Pick<RenderedPage, 'html' | 'styled'>, config: PageConfig, runtimeUrl: string, tokens: Record<string, string>): string {
  const boot = `<script type="application/json" id="${PAGE_CONFIG_ID}">${scriptJson(config)}</script><script src="${escapeAttribute(runtimeUrl)}"></script>`;
  const html = prependToHead(page.html, boot);
  return page.styled ? html : themedHtml(html, tokens);
}

/** Runs at most `limit` jobs at once; refuses new ones while `cap` are running or waiting. */
export function createJobQueue(limit: number, cap: number) {
  let active = 0;
  const waiting: Array<() => Promise<void>> = [];
  const pump = () => {
    while (active < limit && waiting.length) {
      const job = waiting.shift()!;
      active += 1;
      void Promise.resolve()
        .then(job)
        .catch(() => {})
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };
  return {
    add(job: () => Promise<void>): boolean {
      if (active + waiting.length >= cap) return false;
      waiting.push(job);
      pump();
      return true;
    },
    clear() {
      waiting.length = 0;
    }
  };
}

function payloadTooLarge(draft: string): boolean {
  // Cheap bound first: a UTF-16 unit is at most 3 bytes of UTF-8, JSON escapes at most 6.
  if (draft.length * 6 < MAX_RPC_PAYLOAD_BYTES) return false;
  return new TextEncoder().encode(JSON.stringify(draft)).byteLength > MAX_RPC_PAYLOAD_BYTES;
}

function sameProblem(a: PageProblem, b: PageProblem): boolean {
  return a.kind === b.kind && a.message === b.message && a.source === b.source && a.line === b.line;
}

// ── The frame ─────────────────────────────────────────────────────────────

interface Rendered {
  /** Each render loads a fresh frame, even when its HTML did not change. */
  id: number;
  page: RenderedPage;
  srcDoc: string;
  /** Rendered from an editor draft, which agents never see. */
  draft: boolean;
}

interface SelectionChip {
  text: string;
  top: number;
  left: number;
}

interface View {
  hash: string | null;
  scroll: { x: number; y: number } | null;
}

export function PageFrame({
  docId,
  file,
  files,
  draft = false,
  quotes = [],
  onOpenPath,
  onQuote,
  onAskAbout,
  handleRef
}: {
  docId: string;
  file: PreviewFile;
  files: readonly DesignDocFileMeta[];
  /** `file.content` is not the saved page (an editor draft, an old revision): render it as given. */
  draft?: boolean;
  quotes?: readonly string[];
  onOpenPath?(path: string): void;
  onQuote?(text: string): void;
  onAskAbout?(text: string): void;
  handleRef?: MutableRefObject<PreviewHandle | null>;
}) {
  const api = useApi();
  const path = file.path;
  const [width, setWidth] = useState<(typeof FRAME_WIDTHS)[number]['id']>('full');
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const [problems, setProblems] = useState<PageProblem[]>([]);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [redirect, setRedirect] = useState<{ path: string; hash: string | null } | null>(null);
  const [chip, setChip] = useState<SelectionChip | null>(null);
  const [nonce, setNonce] = useState(0);

  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const portRef = useRef<MessagePort | null>(null);
  const readyRef = useRef(false);
  const pendingFocus = useRef<string | null>(null);
  const unanchored = useRef<string[]>([]);
  /** Doc files the running page fetched, and the revision each had then (0 when the doc had none). */
  const fetched = useRef(new Map<string, number>());
  const reportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastReport = useRef('');
  const view = useRef<View>({ hash: pendingHashes.get(hashKey(docId, path)) ?? null, scroll: null });
  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;
  const fetches = useMemo(() => createJobQueue(MAX_FETCHES_ACTIVE, MAX_FETCHES_QUEUED), []);

  useEffect(() => {
    pendingHashes.delete(hashKey(docId, path));
  }, [docId, path]);

  // Drafts re-render once typing pauses; saved pages render at once.
  const content = draft ? file.content : null;
  const [draftText, setDraftText] = useState(content);
  useEffect(() => {
    if (content === draftText) return;
    if (content === null) {
      setDraftText(null);
      return;
    }
    const timer = setTimeout(() => setDraftText(content), DRAFT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [content, draftText]);

  const savedRevision = files.find((entry) => entry.path === path)?.revision ?? null;
  const renderKey = draftText === null ? savedRevision : null;
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    if (draftText !== null && payloadTooLarge(draftText)) {
      setTooLarge(true);
      setBusy(false);
      return;
    }
    setTooLarge(false);
    setBusy(true);
    api.renderPage(docId, { path, draft: draftText ?? undefined }).then(
      (page) => {
        if (id !== seq.current) return;
        const config: PageConfig = {
          mode: 'frame',
          docId,
          path,
          hash: view.current.hash,
          scroll: view.current.scroll,
          quotes: [...quotesRef.current],
          storage: docStorage.get(docId)
        };
        setRendered({ id, page, srcDoc: pageSrcDoc(page, config, RUNTIME_URL, page.styled ? {} : readThemeTokens()), draft: draftText !== null });
        setError(null);
        setBusy(false);
      },
      (failure: unknown) => {
        if (id !== seq.current) return;
        setError(errorMessage(failure));
        setBusy(false);
      }
    );
  }, [api, docId, path, draftText, renderKey, nonce]);

  // Re-render when the doc changes under the page, once per change.
  const retried = useRef('');
  useEffect(() => {
    if (!rendered || busy) return;
    const page = { ...rendered.page, deps: withFetched(rendered.page.deps, fetched.current) };
    if (!renderIsStale(page, files, draftText !== null)) return;
    const signature = files.map((entry) => `${entry.path}@${entry.revision}`).join('|');
    if (retried.current === signature) return;
    retried.current = signature;
    setNonce((value) => value + 1);
  }, [rendered, files, busy, draftText]);

  const send = (message: ToPage, port: MessagePort | null = portRef.current) => {
    try {
      port?.postMessage(message);
    } catch {
      // The page is gone; it asked for nothing that still matters.
    }
  };

  const addProblem = (problem: PageProblem) => {
    setProblems((list) => (list.length >= MAX_PAGE_PROBLEMS || list.some((entry) => sameProblem(entry, problem)) ? list : [...list, problem]));
    scheduleReport();
  };

  // Once a saved page settles, tell the server what it showed so agents can read it.
  const problemsRef = useRef(problems);
  problemsRef.current = problems;
  const renderedRef = useRef(rendered);
  renderedRef.current = rendered;
  const scheduleReport = () => {
    if (reportTimer.current) clearTimeout(reportTimer.current);
    reportTimer.current = setTimeout(() => {
      reportTimer.current = null;
      const current = renderedRef.current;
      const page = current?.page;
      if (!page || current.draft || page.revision === null || !readyRef.current) return;
      const report: PageRenderReport = {
        path: page.path,
        revision: page.revision,
        deps: withFetched(page.deps, fetched.current),
        missing: page.missing,
        problems: problemsRef.current,
        unanchored: unanchored.current
      };
      const signature = JSON.stringify(report);
      if (signature === lastReport.current) return;
      lastReport.current = signature;
      api.reportRender(docId, report).catch(() => {
        lastReport.current = '';
      });
    }, REPORT_DELAY_MS);
  };

  const go = (target: string, hash: string | null) => {
    if (target === path) return;
    if (hash !== null) rememberHash(docId, target, hash);
    onOpenPath?.(target);
  };

  const openTarget = (wanted: string, hash: string | null, isRedirect: boolean) => {
    const known = new Set(files.map((entry) => entry.path));
    const target = known.has(wanted) ? wanted : known.has(`${wanted}/index.html`) ? `${wanted}/index.html` : null;
    if (!target) {
      toast(`${wanted} is not a file in this design doc`, 'error');
      return;
    }
    // Following a redirect would leave no way back to the page that has it.
    if (isRedirect) setRedirect(target === path ? null : { path: target, hash });
    else go(target, hash);
  };

  const openExternal = (raw: string) => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      toast(`Zana opens web links only, not ${url.protocol} links`, 'error');
      return;
    }
    const activation = (globalThis.navigator as { userActivation?: { isActive: boolean } } | undefined)?.userActivation;
    if (activation && !activation.isActive) {
      addProblem({ kind: 'blocked', message: `The page tried to open ${url.href} without a click` });
      return;
    }
    globalThis.open(url.href, '_blank', 'noopener,noreferrer');
  };

  const showChip = (text: string, rect: PageRect | null) => {
    const frame = frameRef.current;
    const viewport = viewportRef.current;
    if (!onQuote || !text || !rect || !frame || !viewport) {
      setChip(null);
      return;
    }
    const frameBox = frame.getBoundingClientRect();
    const box = viewport.getBoundingClientRect();
    const top = frameBox.top - box.top + viewport.scrollTop + rect.top - 36;
    const left = frameBox.left - box.left + viewport.scrollLeft + (rect.left + rect.right) / 2;
    setChip({ text, top: Math.max(4, top), left: Math.min(Math.max(80, left), Math.max(80, viewport.scrollWidth - 80)) });
  };

  const onPageMessage = (message: FromPage, port: MessagePort) => {
    switch (message.type) {
      case 'ready':
        readyRef.current = true;
        send({ type: 'highlight', quotes: [...quotesRef.current] }, port);
        if (pendingFocus.current !== null) send({ type: 'focus', quote: pendingFocus.current }, port);
        pendingFocus.current = null;
        scheduleReport();
        break;
      case 'fetch': {
        if (!fetched.current.has(message.path) && fetched.current.size < MAX_FILES_PER_DOC) {
          fetched.current.set(message.path, files.find((entry) => entry.path === message.path)?.revision ?? 0);
          scheduleReport();
        }
        const queued = fetches.add(async () => {
          let found: PageFile | null = null;
          try {
            found = await api.readPageFile(docId, message.path);
          } catch {
            found = null;
          }
          if (portRef.current === port) send({ type: 'file', id: message.id, file: found }, port);
        });
        if (!queued) send({ type: 'file', id: message.id, file: null }, port);
        break;
      }
      case 'navigate':
        openTarget(message.path, message.hash, message.redirect);
        break;
      case 'open':
        openExternal(message.url);
        break;
      case 'problem':
        addProblem(message.problem);
        break;
      case 'selection':
        showChip(message.text, message.rect);
        break;
      case 'anchors':
        unanchored.current = message.missing;
        scheduleReport();
        break;
      case 'focused':
        if (!message.found) toast('That passage is no longer on this page');
        break;
      case 'scroll':
        view.current.scroll = { x: message.x, y: message.y };
        break;
      case 'hash':
        view.current.hash = message.hash;
        break;
      case 'storage':
        rememberStorage(docId, message.entries);
        break;
      default:
        break;
    }
  };
  const onPageMessageRef = useRef(onPageMessage);
  onPageMessageRef.current = onPageMessage;

  // Each load of the frame (a re-render, the page reloading itself) brings a new port.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      const port = event.ports?.[0];
      if (!frame || !port || event.source !== frame.contentWindow || !isPageHello(event.data)) return;
      portRef.current?.close();
      portRef.current = port;
      readyRef.current = false;
      unanchored.current = [];
      fetched.current = new Map();
      fetches.clear();
      setProblems([]);
      setRedirect(null);
      setChip(null);
      port.onmessage = (incoming: MessageEvent) => {
        if (portRef.current !== port) return;
        const message = parseFromPage(incoming.data);
        if (message) onPageMessageRef.current(message, port);
      };
    };
    globalThis.addEventListener('message', onMessage);
    return () => {
      globalThis.removeEventListener('message', onMessage);
      portRef.current?.close();
      portRef.current = null;
      fetches.clear();
      if (reportTimer.current) clearTimeout(reportTimer.current);
    };
  }, [fetches]);

  const quoteKey = quotes.join('\u0000');
  useEffect(() => {
    if (readyRef.current) send({ type: 'highlight', quotes: quoteKey ? quoteKey.split('\u0000') : [] });
  }, [quoteKey]);

  useEffect(() => {
    if (!handleRef) return;
    const handle: PreviewHandle = {
      focusQuote(quote) {
        if (readyRef.current && portRef.current) send({ type: 'focus', quote });
        else pendingFocus.current = quote;
        return true;
      }
    };
    handleRef.current = handle;
    return () => {
      if (handleRef.current === handle) handleRef.current = null;
    };
  }, [handleRef]);

  const renderProblems = useMemo<PageProblem[]>(
    () =>
      rendered
        ? [
            ...rendered.page.missing.map((missing): PageProblem => ({ kind: 'missing', message: `The page uses ${missing}, which is not a file in this doc` })),
            ...rendered.page.warnings.map((warning): PageProblem => ({ kind: 'blocked', message: warning }))
          ]
        : [],
    [rendered]
  );
  const allProblems = [...renderProblems, ...problems];

  const openInBrowser = async () => {
    try {
      const { url } = await api.pageLink(docId, path);
      globalThis.open(url, '_blank', 'noopener,noreferrer');
    } catch (failure) {
      toast(errorMessage(failure), 'error');
    }
  };

  const applyChip = (handler: ((text: string) => void) | undefined) => {
    if (!chip || !handler) return;
    handler(chip.text);
    setChip(null);
    send({ type: 'clear-selection' });
  };

  const frameWidth = FRAME_WIDTHS.find((option) => option.id === width)!.width;
  return (
    <div
      className="dd-html-stage"
      onMouseDown={(event) => {
        if (!(event.target as Element).closest?.('.dd-selection-chip')) setChip(null);
      }}
    >
      <div className="dd-html-toolbar">
        <div className="dd-html-status">
          {busy ? <Spinner size={12} label="Rendering page" /> : null}
          {draft ? <span className="dd-muted">Unsaved changes</span> : null}
        </div>
        <div className="dd-html-widths" role="toolbar" aria-label="Preview width">
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
        <div className="dd-html-actions">
          {allProblems.length ? (
            <Popover
              open={problemsOpen}
              onClose={() => setProblemsOpen(false)}
              className="dd-page-problems"
              anchor={
                <button
                  type="button"
                  className="dd-page-badge"
                  aria-label={`${allProblems.length} page ${allProblems.length === 1 ? 'problem' : 'problems'}`}
                  aria-expanded={problemsOpen}
                  onClick={() => setProblemsOpen((open) => !open)}
                >
                  <AlertTriangle size={13} aria-hidden />
                  {allProblems.length}
                </button>
              }
            >
              <ul aria-label="Page problems">
                {allProblems.map((problem, index) => (
                  <li key={index} className={`dd-page-problem dd-page-problem-${problem.kind}`}>
                    <span className="dd-page-problem-kind">{PROBLEM_LABELS[problem.kind]}</span>
                    <span className="dd-page-problem-message">{problem.message}</span>
                    {problem.source ? (
                      <span className="dd-muted dd-page-problem-source">
                        {problem.source}
                        {problem.line ? `:${problem.line}` : ''}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Popover>
          ) : null}
          {draft ? null : <IconButton icon={ExternalLink} label="Open in browser" onClick={() => void openInBrowser()} />}
        </div>
      </div>
      {redirect ? (
        <div className="dd-banner dd-banner-info">
          <CornerDownRight size={14} aria-hidden />
          <span className="dd-banner-text">
            This page redirects to <code>{redirect.path}</code>.
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setRedirect(null);
              go(redirect.path, redirect.hash);
            }}
          >
            Go there
          </button>
          <IconButton icon={X} label="Dismiss" onClick={() => setRedirect(null)} />
        </div>
      ) : null}
      {tooLarge ? (
        <div className="dd-banner dd-banner-warn">
          <AlertTriangle size={14} aria-hidden />
          <span className="dd-banner-text">This draft is too large to preview. Save it to see the page.</span>
        </div>
      ) : null}
      {error ? <div className="dd-banner dd-banner-error">{error}</div> : null}
      <div className="dd-html-viewport" ref={viewportRef}>
        {rendered ? (
          <iframe
            key={rendered.id}
            ref={frameRef}
            className={`dd-html-frame${frameWidth ? ' dd-html-frame-device' : ''}`}
            style={frameWidth ? { width: frameWidth } : undefined}
            // Scripts run but the frame keeps an opaque origin: no same-origin,
            // popups or top navigation. Forms only so submit events reach scripts.
            sandbox="allow-scripts allow-forms"
            srcDoc={rendered.srcDoc}
            title={path}
          />
        ) : error || tooLarge ? null : (
          <div className="dd-center">
            <Spinner label="Rendering page" />
          </div>
        )}
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
    </div>
  );
}
