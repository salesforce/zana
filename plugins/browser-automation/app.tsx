import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  definePluginApp,
  useRpc,
  type PluginMessageDirectiveProps,
} from "@zana-ai/zcc-plugin-sdk/app";
import type { PreviewFrame, PreviewOutput, PreviewSize } from "./contracts.js";
import {
  closeLightbox,
  openLightbox,
  useLightboxTarget,
  type LightboxTarget,
} from "./lightbox-store.js";
import { PREVIEW_DIRECTIVE_ID } from "./preview-directive.js";

const MIN_POLL_INTERVAL_MS = 400;
const MAX_RETRY_INTERVAL_MS = 15_000;
const MAX_CONSECUTIVE_FAILURES = 5;
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PreviewStatus = "connecting" | "live" | "ended" | "unavailable";

const STATUS_LABEL: Record<PreviewStatus, string> = {
  connecting: "Connecting",
  live: "Live",
  ended: "Ended",
  unavailable: "Unavailable",
};

const cardStyle: CSSProperties = {
  margin: "0.5rem 0",
  overflow: "hidden",
  borderRadius: "0.5rem",
  border: "1px solid rgba(128, 128, 128, 0.35)",
  background: "rgba(128, 128, 128, 0.06)",
};
const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  width: "100%",
};
const toggleButtonStyle: CSSProperties = {
  display: "flex",
  flex: "1 1 auto",
  minWidth: 0,
  alignItems: "center",
  gap: "0.375rem",
  padding: "0.375rem 0.75rem",
  background: "transparent",
  border: "none",
  color: "inherit",
  font: "inherit",
  fontSize: "0.75rem",
  cursor: "pointer",
  textAlign: "left",
};
const expandButtonStyle: CSSProperties = {
  display: "flex",
  width: "2rem",
  flex: "0 0 auto",
  alignItems: "center",
  justifyContent: "center",
  borderLeft: "1px solid rgba(128, 128, 128, 0.35)",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  fontSize: "0.75rem",
};
const truncate: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const bodyStyle: CSSProperties = {
  borderTop: "1px solid rgba(128, 128, 128, 0.35)",
  padding: "0.5rem",
};
const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "1.5rem",
  background: "rgba(0, 0, 0, 0.6)",
};
const dialogStyle: CSSProperties = {
  maxWidth: "min(96vw, 72rem)",
  maxHeight: "92dvh",
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
  padding: "1rem",
  borderRadius: "0.75rem",
  border: "1px solid rgba(128, 128, 128, 0.35)",
  background: "var(--canvas, #1b1b1b)",
  color: "inherit",
  overflow: "auto",
};

function subscribeDocumentVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function readDocumentVisible(): boolean {
  return document.visibilityState !== "hidden";
}

function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    subscribeDocumentVisibility,
    readDocumentVisible,
    () => true,
  );
}

function useInViewport(): [(element: Element | null) => void, boolean] {
  const [element, setElement] = useState<Element | null>(null);
  const [inViewport, setInViewport] = useState(true);

  useEffect(() => {
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) setInViewport(entry.isIntersecting);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [setElement, inViewport];
}

function pageLocation(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:")
      return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
    if (parsed.protocol === "about:") return url;
    if (parsed.protocol === "file:") return decodeURIComponent(parsed.pathname);
    return parsed.protocol;
  } catch {
    return url.slice(0, 80);
  }
}

function pageTitle(frame: PreviewFrame | null): string {
  const title = frame?.title.trim() ?? "";
  return title === "" || title === frame?.url ? "Headless browser" : title;
}

function useLivePreview(args: {
  threadId: string;
  sessionId: string;
  enabled: boolean;
  size: PreviewSize;
  initialFrame: PreviewFrame | null;
}): { frame: PreviewFrame | null; status: PreviewStatus } {
  const { threadId, sessionId, enabled, size, initialFrame } = args;
  const rpc = useRpc();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [frame, setFrame] = useState<PreviewFrame | null>(initialFrame);
  const [status, setStatus] = useState<PreviewStatus>(
    initialFrame ? "live" : "connecting",
  );
  const settled = status === "ended" || status === "unavailable";

  useEffect(() => {
    if (!enabled || settled) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let afterSequence = 0;
    let failures = 0;
    const poll = async () => {
      const startedAt = Date.now();
      let delayMs: number;
      try {
        const result = (await rpcRef.current.call("preview", {
          threadId,
          sessionId,
          afterSequence,
          size,
        })) as PreviewOutput;
        if (cancelled) return;
        if (
          result.session.state !== "ready" ||
          result.session.backend !== "local"
        ) {
          setStatus(
            result.session.backend === "local" ? "ended" : "unavailable",
          );
          return;
        }
        failures = 0;
        if (result.frame) {
          afterSequence = result.frame.sequence;
          setFrame(result.frame);
          setStatus("live");
        }
        delayMs = Math.max(0, MIN_POLL_INTERVAL_MS - (Date.now() - startedAt));
      } catch {
        if (cancelled) return;
        failures += 1;
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          setStatus("unavailable");
          return;
        }
        delayMs = Math.min(1_000 * 2 ** failures, MAX_RETRY_INTERVAL_MS);
      }
      timeout = setTimeout(() => void poll(), delayMs);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timeout !== null) clearTimeout(timeout);
    };
  }, [enabled, sessionId, settled, size, threadId]);

  return { frame, status };
}

function PreviewImage({
  frame,
  status,
  title,
  maxHeight,
}: {
  frame: PreviewFrame | null;
  status: PreviewStatus;
  title: string;
  maxHeight?: string;
}) {
  const aspect = frame ?? { width: 16, height: 9 };
  if (!frame && status !== "connecting") return null;
  const containerStyle: CSSProperties = {
    overflow: "hidden",
    borderRadius: "0.375rem",
    border: "1px solid rgba(128, 128, 128, 0.35)",
    margin: "0 auto",
    aspectRatio: `${aspect.width} / ${aspect.height}`,
    width:
      maxHeight === undefined
        ? "100%"
        : `min(100%, calc(${maxHeight} * ${aspect.width / aspect.height}))`,
    maxWidth: maxHeight === undefined ? "28rem" : undefined,
  };
  return (
    <div style={containerStyle}>
      {frame ? (
        <img
          src={`data:${frame.mimeType};base64,${frame.data}`}
          alt={
            status === "live"
              ? `Live view of ${title}`
              : `Last view of ${title}`
          }
          draggable={false}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            objectFit: "contain",
            opacity: status === "live" ? 1 : 0.6,
          }}
        />
      ) : (
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading browser preview"
          style={{
            width: "100%",
            height: "100%",
            background: "rgba(128, 128, 128, 0.15)",
          }}
        />
      )}
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div role="alert" style={{ fontSize: "0.875rem", opacity: 0.75 }}>
      {children}
    </div>
  );
}

function BrowserPreviewDirective({
  attributes,
  source,
  message,
}: PluginMessageDirectiveProps) {
  const sessionId = attributes.session?.trim() ?? "";
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return (
      <Notice>
        browser-preview requires a valid session attribute, e.g.{" "}
        <code>::browser-preview{'{session="…"}'}</code>
      </Notice>
    );
  }
  return (
    <BrowserPreviewCard
      threadId={message.threadId}
      sessionId={sessionId}
      source={source}
    />
  );
}

function BrowserPreviewCard({
  threadId,
  sessionId,
  source,
}: {
  threadId: string;
  sessionId: string;
  source: string;
}) {
  const visible = useDocumentVisible();
  const [observe, inViewport] = useInViewport();
  const [expanded, setExpanded] = useState(true);
  const target = useLightboxTarget();
  const enlarged = target?.sessionId === sessionId;
  const bodyId = useId();
  const toggleId = useId();
  const { frame, status } = useLivePreview({
    threadId,
    sessionId,
    enabled: visible && inViewport && expanded && !enlarged,
    size: "thumbnail",
    initialFrame: null,
  });
  const title = pageTitle(frame);
  const location = frame ? pageLocation(frame.url) : "";

  return (
    <section
      ref={observe}
      aria-label="Browser preview"
      title={source}
      style={cardStyle}
    >
      <div
        role="group"
        aria-label={`Browser preview controls: ${title}`}
        style={headerStyle}
      >
        <button
          type="button"
          id={toggleId}
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-label={`Browser preview: ${title}`}
          onClick={() => setExpanded((value) => !value)}
          style={toggleButtonStyle}
        >
          <span aria-hidden style={{ flex: "0 0 auto" }}>
            🌐
          </span>
          <span
            style={{
              display: "flex",
              minWidth: 0,
              flex: "1 1 auto",
              alignItems: "center",
              gap: "0.375rem",
            }}
          >
            <span style={truncate} title={title}>
              {title}
            </span>
            {location ? (
              <span
                style={{ ...truncate, flex: "0 1 auto", opacity: 0.7 }}
                title={frame?.url}
              >
                {location}
              </span>
            ) : null}
          </span>
          <span style={{ flex: "0 0 auto", opacity: 0.7 }}>
            {STATUS_LABEL[status]}
          </span>
          <span aria-hidden style={{ flex: "0 0 auto" }}>
            {expanded ? "▾" : "▸"}
          </span>
        </button>
        {frame ? (
          <button
            type="button"
            aria-haspopup="dialog"
            aria-label="Expand browser preview"
            title="Expand"
            onClick={() => openLightbox({ threadId, sessionId, frame })}
            style={expandButtonStyle}
          >
            ⤢
          </button>
        ) : null}
      </div>
      {expanded && (frame || status === "connecting") ? (
        <div id={bodyId} role="region" aria-labelledby={toggleId} style={bodyStyle}>
          <PreviewImage frame={frame} status={status} title={title} />
        </div>
      ) : null}
      {enlarged && target ? <BrowserPreviewLightbox target={target} /> : null}
    </section>
  );
}

function BrowserPreviewLightbox({ target }: { target: LightboxTarget }) {
  const visible = useDocumentVisible();
  const { frame, status } = useLivePreview({
    threadId: target.threadId,
    sessionId: target.sessionId,
    enabled: visible,
    size: "full",
    initialFrame: target.frame,
  });
  const title = pageTitle(frame);
  const location = frame ? pageLocation(frame.url) : "";

  return (
    <div
      style={backdropStyle}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeLightbox();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Browser preview: ${title}`}
        tabIndex={-1}
        ref={(node) => node?.focus()}
        onKeyDown={(event) => {
          if (event.key === "Escape") closeLightbox();
        }}
        style={dialogStyle}
      >
        <div>
          <div style={{ ...truncate, fontSize: "0.875rem", fontWeight: 600 }}>
            {title}
          </div>
          <div style={{ ...truncate, fontSize: "0.75rem", opacity: 0.7 }}>
            {[location, STATUS_LABEL[status]].filter(Boolean).join(" · ")}
          </div>
        </div>
        <PreviewImage
          frame={frame}
          status={status}
          title={title}
          maxHeight="78dvh"
        />
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.messageDirective({
    id: PREVIEW_DIRECTIVE_ID,
    component: BrowserPreviewDirective,
  });
});
