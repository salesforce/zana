import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { product } from '../lib/product-client.js';
import { dispatchThreadOpenFile } from './thread/secondary-panel/useThreadOpenFileSignal.js';

type Resolution = Awaited<ReturnType<typeof product.threads.resolvePreviewPath>>;
const MAX_PREVIEW_HINTS = 50;

function requestHints(token: string, hints: readonly string[]): string[] {
  if (/[\\/]/u.test(token) || /^[a-z]:/iu.test(token)) return [];
  const lowerToken = token.toLowerCase();
  const relevant = [...new Set(hints.filter((path) => {
    const base = path.split(/[/\\\\]/u).at(-1);
    return base?.toLowerCase() === lowerToken;
  }))];
  // A partial hint set cannot prove that a basename is unique. Let the server
  // perform its bounded exact-name search instead of truncating ambiguity data.
  return relevant.length <= MAX_PREVIEW_HINTS ? relevant : [];
}

function ChoiceButtons({
  paths,
  threadId,
  generation,
  currentGeneration,
  lineNumber
}: {
  paths: string[];
  threadId: string;
  generation: number;
  currentGeneration: { current: number };
  lineNumber: number | null;
}) {
  return <>{paths.map((path) => (
    <button key={path} type="button" onClick={() => {
      if (currentGeneration.current === generation) dispatchThreadOpenFile(threadId, path, lineNumber);
    }}>{path}</button>
  ))}</>;
}

type LinkState =
  | { kind: 'idle' | 'loading' }
  | { kind: 'choices' | 'incomplete'; paths: string[]; generation: number }
  | { kind: 'error'; message: string };

function usePreviewResolution(
  token: string,
  threadId: string,
  projectId: string | null | undefined,
  hints: readonly string[],
  lineNumber: number | null
): { state: LinkState; resolve: () => Promise<void>; generation: { current: number } } {
  const [state, setState] = useState<LinkState>({ kind: 'idle' });
  const generation = useRef(0);
  useLayoutEffect(() => {
    generation.current += 1;
    setState({ kind: 'idle' });
    return () => { generation.current += 1; };
  }, [token, threadId, projectId, lineNumber]);

  const resolve = async () => {
    const request = ++generation.current;
    setState({ kind: 'loading' });
    try {
      const result: Resolution = await product.threads.resolvePreviewPath(threadId, {
        path: token,
        hints: requestHints(token, hints),
        ...(projectId ? { projectId } : {})
      });
      if (generation.current !== request) return;
      if (result.kind === 'resolved') {
        dispatchThreadOpenFile(threadId, result.path, lineNumber);
        setState({ kind: 'idle' });
      } else if (result.kind === 'ambiguous') {
        setState({ kind: 'choices', paths: result.paths, generation: request });
      } else if (result.kind === 'incomplete') {
        setState({ kind: 'incomplete', paths: result.paths, generation: request });
      } else {
        setState({ kind: 'error', message: `Could not find ${result.path}${result.checkedPath ? ` (checked ${result.checkedPath})` : ''}` });
      }
    } catch (error) {
      if (generation.current !== request) return;
      setState({ kind: 'error', message: error instanceof Error ? error.message : 'Could not resolve this file' });
    }
  };
  return { state, resolve, generation };
}

function FileLinkTrigger({
  token,
  title,
  link,
  href,
  children,
  loading,
  onResolve
}: {
  token: string;
  title: string;
  link: boolean;
  href?: string;
  children?: ReactNode;
  loading: boolean;
  onResolve: () => void;
}) {
  const basename = token.split(/[/\\\\]/u).pop() ?? token;
  const label = loading ? 'Resolving…' : children ?? token;
  if (link) {
    return (
      <a
        className="inbox-md-file-link"
        href={href ?? token}
        aria-label={`Preview ${basename}`}
        aria-disabled={loading}
        title={title}
        onClick={(event) => { event.preventDefault(); if (!loading) onResolve(); }}
        onAuxClick={(event) => { event.preventDefault(); if (event.button === 1 && !loading) onResolve(); }}
      >
        {label}
      </a>
    );
  }
  return (
    <button
      type="button"
      className="inbox-md-file-chip"
      data-testid="inbox-md-file-chip"
      aria-label={`Preview ${basename}`}
      title={title}
      disabled={loading}
      onClick={onResolve}
    >
      {label}
    </button>
  );
}

function ResolutionStatus({
  state,
  token,
  threadId,
  generation,
  onRetry,
  lineNumber
}: {
  state: LinkState;
  token: string;
  threadId: string;
  generation: { current: number };
  onRetry: () => void;
  lineNumber: number | null;
}) {
  if (state.kind === 'choices') {
    return (
      <span role="group" aria-label={`Choose a file matching ${token}`}>
        <ChoiceButtons paths={state.paths} threadId={threadId} generation={state.generation} currentGeneration={generation} lineNumber={lineNumber} />
      </span>
    );
  }
  if (state.kind === 'incomplete') {
    return (
      <span role="status">
        {state.paths.length > 0 ? 'Could not check every folder. Choose a result or use a full path.' : 'Could not check every folder. Use a full path.'}
        {state.paths.length > 0 ? (
          <ChoiceButtons paths={state.paths} threadId={threadId} generation={state.generation} currentGeneration={generation} lineNumber={lineNumber} />
        ) : null}
      </span>
    );
  }
  if (state.kind === 'error') {
    return (
      <span role="status">
        {state.message} <button type="button" onClick={onRetry}>Try again</button>
      </span>
    );
  }
  return null;
}

export function MarkdownFileLink({
  token,
  title = token,
  threadId,
  projectId,
  hints = [],
  children,
  link = false,
  href,
  lineNumber = null
}: {
  token: string;
  title?: string;
  threadId: string;
  projectId?: string | null;
  hints?: readonly string[];
  children?: ReactNode;
  link?: boolean;
  href?: string;
  lineNumber?: number | null;
}) {
  const { state, resolve, generation } = usePreviewResolution(token, threadId, projectId, hints, lineNumber);

  return (
    <span className="inbox-md-file-link-wrap">
      <FileLinkTrigger
        token={token}
        title={title}
        link={link}
        href={href}
        loading={state.kind === 'loading'}
        onResolve={() => { void resolve(); }}
      >
        {children}
      </FileLinkTrigger>
      <ResolutionStatus
        state={state}
        token={token}
        threadId={threadId}
        generation={generation}
        lineNumber={lineNumber}
        onRetry={() => { void resolve(); }}
      />
    </span>
  );
}

export function UnavailableMarkdownFileLink({ message, children }: { message: string; children?: ReactNode }) {
  const [visible, setVisible] = useState(false);
  return <span className="inbox-md-file-link-wrap">
    <button type="button" className="inbox-md-file-chip" onClick={() => setVisible(true)}>{children}</button>
    {visible ? <span role="status">{message}</span> : null}
  </span>;
}
