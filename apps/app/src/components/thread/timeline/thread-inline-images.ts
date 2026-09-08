const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|bmp|avif|svg)$/iu;
const SAFE_IMAGE_DATA_URL =
  /^data:image\/[a-z0-9.+-]+(?:;[\w.=+-]+)*,/iu;
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\((<)?([^)\s]+)\2?\)/gu;
const BARE_DATA_IMAGE =
  /data:image\/[a-z0-9.+-]+(?:;[\w.=+-]+)*;base64,[a-z0-9+/_=-]+/giu;

export interface ExtractedThreadImage {
  src: string;
  alt: string;
}

export function isSafeImageDataUrl(value: string): boolean {
  return SAFE_IMAGE_DATA_URL.test(value.trim());
}

export function isRemoteOrBlobImageSrc(value: string): boolean {
  return /^(https?:|blob:)/iu.test(value.trim());
}

/** Absolute disk / file: URLs the renderer cannot fetch as <img src>. */
export function isDiskImagePath(value: string): boolean {
  const trimmed = value.trim();
  if (!IMAGE_EXT.test(trimmed.split('?')[0] ?? trimmed)) return false;
  if (trimmed.startsWith('file:')) return true;
  return trimmed.startsWith('/') || /^[a-zA-Z]:[\\/]/u.test(trimmed);
}

export function shouldLiftMarkdownImageSrc(src: string): boolean {
  const trimmed = src.trim();
  if (isSafeImageDataUrl(trimmed) || isRemoteOrBlobImageSrc(trimmed)) return false;
  return isDiskImagePath(trimmed);
}

export function threadImageStubLabel(path: string): string {
  const trimmed = path.trim();
  if (isSafeImageDataUrl(trimmed)) return 'Image';
  const withoutFile = trimmed.replace(/^file:\/\//iu, '');
  const name = withoutFile.replace(/\\/g, '/').split('/').pop() ?? withoutFile;
  if (name.length > 64) return `${name.slice(0, 61)}…`;
  return name || 'Image';
}

function decodeMarkdownImageSrc(raw: string): string {
  try {
    return decodeURI(raw.trim());
  } catch {
    return raw.trim();
  }
}

/**
 * Pull dumped image sources out of message text so they render as thumbs
 * instead of a path or base64 blob. Markdown `![](data:…)` / http images stay
 * in the body — those can display inline once the markdown URL transform
 * allows them.
 */
export function extractInlineThreadImages(text: string): {
  text: string;
  images: ExtractedThreadImage[];
} {
  const images: ExtractedThreadImage[] = [];
  let next = text.replace(MARKDOWN_IMAGE, (full, alt: string, _lt: string, src: string) => {
    const decoded = decodeMarkdownImageSrc(src);
    if (!shouldLiftMarkdownImageSrc(decoded)) return full;
    images.push({ src: decoded, alt: alt.trim() || threadImageStubLabel(decoded) });
    return '';
  });

  next = next.replace(BARE_DATA_IMAGE, (url, offset: number, whole: string) => {
    const before = whole.slice(Math.max(0, offset - 4), offset);
    if (before.endsWith('](') || before.endsWith('](<')) return url;
    images.push({ src: url, alt: 'Image' });
    return '';
  });

  next = next.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (isSafeImageDataUrl(trimmed) || isDiskImagePath(trimmed)) {
      images.push({ src: trimmed, alt: threadImageStubLabel(trimmed) });
      return '';
    }
    return line;
  }).join('\n');

  return {
    text: next.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
    images
  };
}

export function transformMarkdownMediaUrl(
  url: string,
  defaultUrlTransform: (value: string) => string
): string {
  const trimmed = url.trim();
  if (
    trimmed.startsWith('zcc-thread:')
    || trimmed.startsWith('file:')
    || isSafeImageDataUrl(trimmed)
    || trimmed.startsWith('blob:')
  ) {
    return trimmed;
  }
  return defaultUrlTransform(url);
}
