export const DEFAULT_HEIGHT_PX = 224;
export const MIN_HEIGHT_PX = 120;
export const MAX_HEIGHT_PX = 1_200;
export const MAX_HTML_CHARS = 5 * 1024 * 1024;
export const PREVIEW_SOURCES = Object.freeze(['workspace', 'thread-storage']);

const PREVIEW_KIND_BY_EXTENSION = {
  '.html': 'html',
  '.htm': 'html',
  '.md': 'markdown',
  '.markdown': 'markdown'
};

export function parsePreviewHeight(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length === 0) return DEFAULT_HEIGHT_PX;
  if (!/^\d+$/.test(normalized)) return null;
  const height = Number(normalized);
  return Number.isSafeInteger(height) && height >= MIN_HEIGHT_PX && height <= MAX_HEIGHT_PX
    ? height
    : null;
}

export function parsePreviewSource(value) {
  if (value === undefined || value === null || value === '') return 'workspace';
  const source = typeof value === 'string' ? value.trim() : '';
  return PREVIEW_SOURCES.includes(source) ? source : null;
}

function previewKind(file) {
  const dot = file.lastIndexOf('.');
  if (dot < 0) return null;
  return PREVIEW_KIND_BY_EXTENSION[file.slice(dot).toLowerCase()] ?? null;
}

export function requirePreviewFile(value) {
  const file = typeof value === 'string' ? value.trim() : '';
  if (!file) return null;
  if (file.split(/[/\\]/).includes('..')) return null;
  if (file.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(file) || file.startsWith('\\\\')) return null;
  const slashNormalized = file.replace(/\\/g, '/');
  if (slashNormalized.startsWith('/') || slashNormalized === '.' || slashNormalized.startsWith('../')) {
    return null;
  }
  if (!previewKind(slashNormalized)) return null;
  return slashNormalized;
}

/** @deprecated Use {@link requirePreviewFile}. HTML-only helper kept for callers. */
export function requireWorkspaceHtmlFile(value) {
  const file = requirePreviewFile(value);
  if (!file) return null;
  return previewKind(file) === 'html' ? file : null;
}

export function previewKindForFile(file) {
  return previewKind(file);
}

export function previewContentUrl(threadId, file, source = 'workspace') {
  const params = new URLSearchParams({ path: file });
  const route = source === 'thread-storage' ? 'thread-storage/content' : 'host-files/content';
  return `/api/v1/threads/${encodeURIComponent(threadId)}/${route}?${params.toString()}`;
}

export function hostFileContentUrl(threadId, file) {
  return previewContentUrl(threadId, file, 'workspace');
}

export function escapePreviewText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function httpHref(href) {
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function inlineNodes(React, text) {
  const nodes = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const token = match[0];
    if (token.startsWith('`')) {
      nodes.push(React.createElement('code', { key: `c${key++}` }, token.slice(1, -1)));
    } else if (token.startsWith('**')) {
      nodes.push(React.createElement('strong', { key: `s${key++}` }, token.slice(2, -2)));
    } else {
      const labeled = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = labeled ? httpHref(labeled[2]) : null;
      nodes.push(
        href
          ? React.createElement('a', { key: `a${key++}`, href, rel: 'noreferrer', target: '_blank' }, labeled[1])
          : token
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/**
 * Host-side Markdown with raw HTML off. The plugin cannot import the app
 * Markdown renderer, so this emits React elements only — never innerHTML.
 */
export function renderSafeMarkdown(React, markdown) {
  const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;
  let fence = null;
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      React.createElement('p', { key: `p${key++}` }, inlineNodes(React, paragraph.join(' ')))
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push(
      React.createElement(
        'ul',
        { key: `ul${key++}` },
        list.map((item, index) => React.createElement('li', { key: index }, inlineNodes(React, item)))
      )
    );
    list = null;
  };

  for (const line of lines) {
    const fenceOpen = line.match(/^```(.*)$/);
    if (fence) {
      if (line.startsWith('```')) {
        blocks.push(React.createElement('pre', { key: `pre${key++}` }, React.createElement('code', null, fence.lines.join('\n'))));
        fence = null;
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    if (fenceOpen) {
      flushParagraph();
      flushList();
      fence = { lines: [] };
      continue;
    }
    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(React.createElement(`h${level}`, { key: `h${key++}` }, inlineNodes(React, heading[2])));
      continue;
    }
    const item = line.match(/^[-*]\s+(.*)$/);
    if (item) {
      flushParagraph();
      list = list ?? [];
      list.push(item[1]);
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  if (fence) {
    blocks.push(React.createElement('pre', { key: `pre${key++}` }, React.createElement('code', null, fence.lines.join('\n'))));
  }
  return React.createElement('div', { className: 'plugin-directive-vis-markdown' }, blocks);
}
