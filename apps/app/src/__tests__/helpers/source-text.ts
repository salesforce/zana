// Purpose: read a checked-in source or CSS file as text for source-assertion
//   tests, with CRLF normalised to LF. Checkouts with core.autocrlf=true write
//   CRLF working files, which would never match the LF literals tests assert on.
// External calls: node:fs readFileSync.
// Updated: 2026-10-24 00:00Z

import { readFileSync, type PathOrFileDescriptor } from 'node:fs';

export function readSourceText(path: PathOrFileDescriptor): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}
