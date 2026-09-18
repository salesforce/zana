/** Containers offered to the browser's native player; codec support varies. */
const VIDEO_TYPES: Readonly<Record<string, string>> = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm',
  mov: 'video/quicktime', ogv: 'video/ogg', ogg: 'video/ogg',
  mkv: 'video/x-matroska'
};

export function videoContentType(path: string): string | null {
  const extension = path.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase();
  return extension && Object.hasOwn(VIDEO_TYPES, extension) ? VIDEO_TYPES[extension] : null;
}

export const FILE_RANGE_MAX_BYTES = 1024 * 1024;
