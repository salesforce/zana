import { SQUAD_GOAL_MAX_CHARS, formatSquadChars } from '@zana-ai/zcc-domain/squad-proposal';

const RECOVERY_BLOCK_SEPARATOR = '\n\n';

/** The parts of a timeout-recovery successor's goal, before any shortening. */
export interface RecoveryTextInput {
  objective?: string;
  header: string;
  sections: readonly string[];
  /** The unresolved human question; it exists nowhere else in the successor. */
  pinnedSection?: string;
  sourceExecutionId: string;
  limit?: number;
}

function plainRecoveryText(input: RecoveryTextInput): string {
  return [input.objective, input.header, ...input.sections, input.pinnedSection].filter(Boolean).join(RECOVERY_BLOCK_SEPARATOR);
}

/** Cut `text` to at most `max` UTF-16 code units without splitting a surrogate pair. */
function safeCut(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

/**
 * Cut a pinned section to `max`, keeping its last line (the instruction) whole and
 * shortening the list before it with an ellipsis.
 */
function fitPinned(text: string, max: number): string {
  if (text.length <= max) return text;
  const split = text.lastIndexOf('\n');
  const tail = split >= 0 ? text.slice(split) : '';
  const room = max - tail.length - 1;
  if (split <= 0 || room <= 0) return safeCut(text, max);
  return `${safeCut(text.slice(0, split), room)}…${tail}`;
}

/**
 * Builds the objective of a timeout-recovery run so it never exceeds the Squad
 * goal limit. When the plain join fits it is returned unchanged; otherwise the
 * objective and header are kept, `pinnedSection` (the unresolved human question,
 * which exists nowhere else in the successor) is reserved up to half of the
 * limit, and the sections fill what is left. The result is a bounded preview:
 * when it is shortened, the full outputs and questions remain only in the source
 * execution's record, which the successor's members cannot read.
 */
export function fitRecoveryObjective(input: RecoveryTextInput): string {
  const limit = input.limit ?? SQUAD_GOAL_MAX_CHARS;
  const { header, sections } = input;
  let objective = input.objective;
  const plain = plainRecoveryText(input);
  if (plain.length <= limit) return plain;

  // A recovery of a recovery: drop the earlier block so the original goal survives whole.
  if (objective) {
    const earlier = objective.startsWith(header) ? 0 : objective.indexOf(`${RECOVERY_BLOCK_SEPARATOR}${header}`);
    if (earlier >= 0) objective = objective.slice(0, earlier);
  }

  const marker = `${RECOVERY_BLOCK_SEPARATOR}[Recovery context shortened to fit the ${formatSquadChars(limit)}-character goal limit. Full outputs and questions: execution ${input.sourceExecutionId}.]`;
  const pinned = input.pinnedSection ? fitPinned(input.pinnedSection, Math.floor(limit / 2)) : '';
  const pinnedBlock = pinned ? `${RECOVERY_BLOCK_SEPARATOR}${pinned}` : '';
  const tailBlock = header + pinnedBlock + marker;
  let head: string;
  if (!objective) {
    head = header;
  } else if (objective.length + RECOVERY_BLOCK_SEPARATOR.length + tailBlock.length <= limit) {
    head = `${objective}${RECOVERY_BLOCK_SEPARATOR}${header}`;
  } else {
    const room = limit - RECOVERY_BLOCK_SEPARATOR.length - tailBlock.length - 1;
    head = room > 0 ? `${safeCut(objective, room)}…${RECOVERY_BLOCK_SEPARATOR}${header}` : header;
  }

  let remaining = limit - head.length - pinnedBlock.length - marker.length;
  let body = '';
  for (const section of sections) {
    if (!section) continue;
    const piece = `${RECOVERY_BLOCK_SEPARATOR}${section}`;
    if (piece.length <= remaining) {
      body += piece;
      remaining -= piece.length;
      continue;
    }
    const room = remaining - RECOVERY_BLOCK_SEPARATOR.length;
    if (room > 0) body += `${RECOVERY_BLOCK_SEPARATOR}${safeCut(section, room)}`;
    break;
  }
  return safeCut(`${head}${body}${pinnedBlock}${marker}`, limit);
}
