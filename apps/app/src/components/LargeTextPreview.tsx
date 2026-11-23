import { useState } from 'react';
import { copyText } from '../lib/copy-text.js';

export const TEXT_PREVIEW_CHARS = 64_000;
export const TEXT_PREVIEW_LINES = 1_000;

/** Stop scanning as soon as either budget is reached. */
export function boundedText(text: string, chars = TEXT_PREVIEW_CHARS, lines = TEXT_PREVIEW_LINES): string {
  const candidate = text.slice(0, chars);
  let end = candidate.length;
  let offset = 0;
  for (let line = 0; line < lines; line++) {
    const next = candidate.indexOf('\n', offset);
    if (next < 0 || next >= end) break;
    offset = next + 1;
    if (line === lines - 1) end = offset;
  }
  return candidate.slice(0, end);
}

const DATA_URL_PAYLOAD = /(data:[\w.+-]+\/[\w.+-]+;base64,)[A-Za-z0-9+/=]+/g;
/** Ceiling on the raw text, embedded images included, so a document of huge inlined images still falls back to the preview. */
export const TEXT_PREVIEW_RAW_CHARS = 8_000_000;

/**
 * The text the size caps apply to: embedded base64 `data:` payloads (images a caller inlined) count as a
 * short stub, so a small document with screenshots is not mistaken for a huge one.
 */
export function measuredText(text: string): string {
  return text.includes(';base64,') ? text.replace(DATA_URL_PAYLOAD, '$1') : text;
}

/**
 * True when a document that may carry inlined images should show the preview instead of rendering: it is over
 * the character or line cap ignoring `data:` payloads, or over the raw ceiling with them.
 */
export function isOversizedText(text: string): boolean {
  if (text.length > TEXT_PREVIEW_RAW_CHARS) return true;
  const measured = measuredText(text);
  return boundedText(measured).length < measured.length;
}

function previewNotice(shortened: boolean, hidesImageData: boolean): string {
  if (shortened) return `Showing a text preview: this document is over ${TEXT_PREVIEW_LINES.toLocaleString('en-US')} lines or ${TEXT_PREVIEW_CHARS.toLocaleString('en-US')} characters.`;
  if (hidesImageData) return `Showing a text preview: this document is over ${TEXT_PREVIEW_RAW_CHARS.toLocaleString('en-US')} characters including embedded images, which are not shown.`;
  return 'Showing a text preview.';
}

/** `ignoreDataUrls`: the caller decided with `isOversizedText`, so base64 payloads are left out of the shown text. Copy still copies everything. */
export function LargeTextPreview({ text, ignoreDataUrls = false }: { text: string; ignoreDataUrls?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const measured = ignoreDataUrls ? measuredText(text) : text;
  const preview = boundedText(measured);
  const shortened = preview.length < measured.length;
  return <div>
    <p role="status">{previewNotice(shortened, ignoreDataUrls && measured.length < text.length)}</p>
    <button type="button" className="btn" onClick={() => {
      void copyText(text).then(() => { setCopied(true); setFailed(false); }).catch(() => setFailed(true));
    }}>{copied ? 'Copied full text' : 'Copy full text'}</button>
    {failed && <p role="alert">Could not copy text.</p>}
    <pre className="inbox-doc-pre">{preview}</pre>
    {shortened && <p>Preview shortened. Copy full text to read the complete content.</p>}
  </div>;
}
