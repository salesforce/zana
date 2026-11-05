import type { Persona } from '@zana-ai/zcc-domain/product';

/**
 * Squad seat contract (#675): what a Squad seat on Codex or OpenCode gets from
 * its persona. Pure helpers only; PtyManager does the file and env work.
 *
 * A shim is a guardrail for an agent that follows instructions, not a sandbox:
 * an absolute path such as `/usr/bin/gh` bypasses it, and a login shell may put
 * system paths ahead of the shim directory (see .zana/design/shim-proof.md).
 */

/** A persona denylist entry a PATH shim can enforce: `Bash(<words>:*)` with a plain command name. */
export interface ShimmableEntry {
  /** The original persona entry, kept for messages. */
  readonly entry: string;
  /** Command name, matching `^[A-Za-z0-9._+-]+$`. */
  readonly command: string;
  /** Argument words that must follow the command for the entry to match (may be empty = any call). */
  readonly prefix: readonly string[];
}

/** A persona denylist entry a shim cannot express; it is listed in the seat's instructions instead. */
export interface AdvisoryEntry {
  readonly entry: string;
  readonly reason: string;
}

export interface ParsedDeniedEntries {
  readonly shimmable: readonly ShimmableEntry[];
  readonly advisory: readonly AdvisoryEntry[];
}

export interface SeatContractInput {
  readonly persona: Pick<Persona, 'appendSystemPrompt' | 'deniedTools'>;
  /** Harness command names the shim must never shadow. */
  readonly reservedCommands?: readonly string[];
}

export interface SeatShimFile {
  /** File name inside the per-session shim directory (the denied command name). */
  readonly name: string;
  readonly script: string;
}

export interface SeatContractPlan {
  /** Persona instructions plus the "not mechanically enforced" lines; empty when there is nothing to say. */
  readonly instructionsText: string;
  readonly shimFiles: readonly SeatShimFile[];
  readonly advisoryLines: readonly string[];
}

const SAFE_COMMAND = /^[A-Za-z0-9._+-]+$/;
/** Commands that run another command; a shim for them would not cover what they launch. */
const WRAPPER_COMMANDS = new Set(['env']);
const BASH_ENTRY = /^Bash\((.*):\*\)$/s;
const ADVISORY_HEADER = 'Denied by Squad policy, not mechanically enforced on this harness:';

/** Split a persona's `deniedTools` into shim-enforceable and advisory entries (D3, D4). */
export function parseDeniedEntries(deniedTools: readonly string[] | undefined): ParsedDeniedEntries {
  const shimmable: ShimmableEntry[] = [];
  const advisory: AdvisoryEntry[] = [];
  for (const entry of deniedTools ?? []) {
    const match = BASH_ENTRY.exec(entry);
    if (!match) {
      advisory.push({ entry, reason: 'not a Bash command entry' });
      continue;
    }
    const words = match[1]!.trim().split(/\s+/).filter((word) => word.length > 0);
    const command = words[0];
    if (command === undefined) {
      advisory.push({ entry, reason: 'no command name' });
    } else if (!SAFE_COMMAND.test(command)) {
      advisory.push({ entry, reason: 'command name is a path, an assignment or not a plain name' });
    } else if (WRAPPER_COMMANDS.has(command)) {
      advisory.push({ entry, reason: 'wrapper command, the command it runs is not covered' });
    } else {
      shimmable.push({ entry, command, prefix: words.slice(1) });
    }
  }
  return { shimmable, advisory };
}

/** Single-quote a string for POSIX sh; the content is data and is never interpreted. */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** sh expression for a prefix word; `~` also matches the home directory. */
function wordExpression(word: string): string {
  return word.split('~').map(shQuote).join('"$HOME"');
}

/** POSIX shell script for one denied command: refuse matching prefixes with exit 126, otherwise run the real binary (D3). */
export function buildShimScript(command: string, prefixes: readonly (readonly string[])[]): string {
  const checks = prefixes.map((prefix) => {
    const label = [command, ...prefix].join(' ');
    const tests = [`[ "$#" -ge ${prefix.length} ]`];
    prefix.forEach((word, index) => {
      const arg = `"$${index + 1}"`;
      tests.push(word.includes('~')
        ? `{ [ ${arg} = ${shQuote(word)} ] || [ ${arg} = ${wordExpression(word)} ]; }`
        : `[ ${arg} = ${shQuote(word)} ]`);
    });
    return [
      `if ${tests.join(' && ')}; then`,
      `  printf '%s\\n' ${shQuote(`Refused by Squad policy: ${label}`)} >&2`,
      '  exit 126',
      'fi'
    ].join('\n');
  });
  return [
    '#!/bin/sh',
    '# Squad policy shim (guardrail, not a sandbox). Generated; do not edit.',
    ...checks,
    'self_dir=$(cd "$(dirname "$0")" 2>/dev/null && pwd -P)',
    'real=',
    'old_ifs=$IFS',
    'IFS=:',
    'for d in $PATH; do',
    '  [ -n "$d" ] || d=.',
    '  dir=$(cd "$d" 2>/dev/null && pwd -P) || continue',
    '  [ "$dir" = "$self_dir" ] && continue',
    `  if [ -f "$d"/${shQuote(command)} ] && [ -x "$d"/${shQuote(command)} ]; then real="$d"/${shQuote(command)}; break; fi`,
    'done',
    'IFS=$old_ifs',
    `[ -n "$real" ] || { printf '%s\\n' ${shQuote(`${command}: command not found`)} >&2; exit 127; }`,
    'exec "$real" "$@"',
    ''
  ].join('\n');
}

/** Everything a seat needs from its persona: instructions text, shim files and advisory lines (D3, D4). */
export function planSeatContract(input: SeatContractInput): SeatContractPlan {
  const parsed = parseDeniedEntries(input.persona.deniedTools);
  const reserved = new Set(input.reservedCommands ?? []);
  const advisory: AdvisoryEntry[] = [...parsed.advisory];
  const byCommand = new Map<string, string[][]>();
  for (const item of parsed.shimmable) {
    if (reserved.has(item.command)) {
      advisory.push({ entry: item.entry, reason: 'would shadow the harness command' });
      continue;
    }
    const list = byCommand.get(item.command) ?? [];
    if (!list.some((prefix) => prefix.join('\0') === item.prefix.join('\0'))) list.push([...item.prefix]);
    byCommand.set(item.command, list);
  }
  const shimFiles = [...byCommand].map(([name, prefixes]) => ({ name, script: buildShimScript(name, prefixes) }));
  const advisoryLines = advisory.map((item) => `- ${item.entry} (${item.reason})`);
  const personaText = input.persona.appendSystemPrompt?.trim() ?? '';
  const instructionsText = [personaText, advisoryLines.length > 0 ? [ADVISORY_HEADER, ...advisoryLines].join('\n') : '']
    .filter((part) => part.length > 0)
    .join('\n\n');
  return { instructionsText, shimFiles, advisoryLines };
}

/** Append the persona's text after the product guidance so the seat gets one guidance value (D2). */
export function foldPersonaIntoGuidance(guidance: string, persona: Pick<Persona, 'appendSystemPrompt'>): string {
  const text = persona.appendSystemPrompt?.trim() ?? '';
  if (text.length === 0) return guidance;
  return guidance.length === 0 ? text : `${guidance}\n\n${text}`;
}
