const PDF_MIME_TYPE = 'application/pdf';
const PDF_MAGIC = '%PDF';

export function encodePathQuery(path) {
  return new URLSearchParams({ path }).toString();
}

export function resolvePdfReadTarget(path, source) {
  const threadId = typeof source?.threadId === 'string' ? source.threadId : null;
  if (!threadId) return null;
  if (source.kind === 'thread-storage') {
    return `/api/v1/threads/${encodeURIComponent(threadId)}/thread-storage/content?${encodePathQuery(path)}`;
  }
  if (source.kind === 'workspace' || source.kind === 'host') {
    return `/api/v1/threads/${encodeURIComponent(threadId)}/host-files/content?${encodePathQuery(path)}`;
  }
  return null;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function bytesFromFileResponse(payload) {
  if (!isRecord(payload) || typeof payload.content !== 'string') {
    throw new Error('The file response was not a PDF.');
  }
  const encoding = payload.encoding === 'base64' ? 'base64' : 'utf8';
  const bytes = encoding === 'base64' ? decodeBase64(payload.content) : new TextEncoder().encode(payload.content);
  const header = new TextDecoder().decode(bytes.slice(0, 4));
  if (header !== PDF_MAGIC) {
    throw new Error('The file response was not a PDF.');
  }
  return bytes;
}

export function pdfBlobFromFileResponse(payload) {
  const bytes = bytesFromFileResponse(payload);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: PDF_MIME_TYPE });
}
