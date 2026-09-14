import { useRef } from 'react';
import {
  findMarkdownPieceCandidates,
  markdownHasGlobalConstructs
} from './markdown-block-scan.js';

export function resolveIncrementalMarkdownPieces(
  body: string,
  previous: readonly string[]
): readonly string[] {
  if (!body) return [body];
  if (markdownHasGlobalConstructs(body)) return [body];
  if (previous.length === 0) return [body];
  const candidates = findMarkdownPieceCandidates(body);
  const pieces: string[] = [];
  let start = 0;
  for (const prev of previous) {
    if (!body.startsWith(prev, start)) break;
    const end = start + prev.length;
    if (end !== body.length && !candidates.includes(end)) break;
    pieces.push(prev);
    start = end;
  }
  if (start >= body.length) return pieces;
  const rest = body.slice(start);
  if (markdownHasGlobalConstructs(rest)) return [body];
  const restStarts = [start, ...candidates.filter((offset) => offset > start)];
  for (let index = 0; index < restStarts.length; index += 1) {
    const pieceStart = restStarts[index] ?? start;
    const pieceEnd = restStarts[index + 1] ?? body.length;
    if (pieceEnd <= pieceStart) continue;
    pieces.push(body.slice(pieceStart, pieceEnd));
  }
  return pieces.length > 0 ? pieces : [body];
}

export function useIncrementalMarkdownPieces(
  text: string,
  enabled = true
): readonly string[] {
  const previousRef = useRef<readonly string[]>([]);
  if (!enabled) {
    previousRef.current = [];
    return [text];
  }
  const pieces = resolveIncrementalMarkdownPieces(text, previousRef.current);
  previousRef.current = pieces;
  return pieces;
}
