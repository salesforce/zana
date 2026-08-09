// Standalone probe of the Slack answer-relay's two deepest links, against REAL
// transcript data, without touching the running app:
//   (1) readLastTurn  — extract the last assistant prose from a transcript JSONL
//   (2) turn-summary  — run the exact `claude --print --model haiku` micro-call
//       with the builtin:turn-summary system prompt over that prose.
// If (1) yields text and (2) returns prose, the relay's content path is sound
// and the live failure is upstream (idle edge not firing / no thread row /
// stale main process). If either is empty, we've found the broken link.
//
// Usage: node scripts/debug-relay.mjs [/abs/path/to/transcript.jsonl]
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const TRANSCRIPT = process.argv[2];
if (!TRANSCRIPT) {
  console.log('Usage: node scripts/debug-relay.mjs /abs/path/to/transcript.jsonl');
  process.exit(1);
}

// --- Link 1: extractLastAssistantText (verbatim from transcript-reader.ts) ---
function extractLastAssistantText(lines, maxChars = 4000) {
  let last = '';
  for (const line of lines) {
    if (line.type !== 'assistant') continue;
    const blocks = line.message?.content;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        last = block.text.trim();
      }
    }
  }
  return last.length > maxChars ? last.slice(last.length - maxChars) : last;
}

function parseJsonl(raw) {
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
  return out;
}

// --- Link 2: ClaudeCliProvider.run (verbatim args from claude-cli-provider.ts) ---
const SYSTEM = [
  'You summarize what a coding agent just said or did in its LATEST turn, for a',
  'teammate reading on Slack. Reply with 1 to 3 terse, plain-text sentences —',
  'no preamble, no code fences, no Markdown headings or bullets, no tool use.',
  'If the agent asked the user a question or is waiting on a decision, LEAD with',
  'that question. Summarize only what the turn shows — never invent steps, files,',
  'or outcomes. If the turn is too thin to tell what happened, say so in one',
  'short honest sentence instead of padding.'
].join(' ');

function runMicro(binary, system, user, model, timeoutMs = 30000, maxOutputChars = 600) {
  const args = ['--print'];
  if (model) args.push('--model', model);
  if (system.trim()) args.push('--system-prompt', system);
  args.push('--');
  args.push(user);
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(binary, args, { cwd: tmpdir(), env: { ...process.env }, shell: false });
    } catch (err) {
      resolve({ ok: false, error: String(err), ms: Date.now() - startedAt });
      return;
    }
    let out = '';
    let err = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill('SIGKILL');
      } catch {}
      resolve({ ok: false, error: `timed out after ${timeoutMs}ms`, ms: Date.now() - startedAt });
    }, timeoutMs);
    proc.stdout?.on('data', (c) => {
      if (out.length < maxOutputChars * 4) out += c.toString('utf8');
    });
    proc.stderr?.on('data', (c) => {
      if (err.length < 4000) err += c.toString('utf8');
    });
    proc.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: String(e), ms: Date.now() - startedAt });
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ ok: false, error: err.trim() || `exit ${code}`, ms: Date.now() - startedAt });
        return;
      }
      resolve({ ok: true, text: out.trim().slice(0, maxOutputChars), ms: Date.now() - startedAt });
    });
  });
}

const binary = process.env.ZCC_CLAUDE_BINARY || 'claude';
console.log(`[probe] transcript = ${TRANSCRIPT}`);
console.log(`[probe] claude binary = ${binary}`);

let raw;
try {
  raw = readFileSync(TRANSCRIPT, 'utf8');
} catch (e) {
  console.log(`[probe] FAIL: cannot read transcript: ${e.message}`);
  process.exit(1);
}
const lines = parseJsonl(raw);
console.log(`[probe] parsed ${lines.length} transcript lines`);
const lastTurn = extractLastAssistantText(lines);
console.log(`[probe] LINK 1 readLastTurn → ${lastTurn.length} chars`);
if (!lastTurn.trim()) {
  console.log('[probe] LINK 1 EMPTY — relay would post nothing (no last assistant prose).');
  process.exit(0);
}
console.log('[probe] --- last turn (first 400 chars) ---');
console.log(lastTurn.slice(0, 400));
console.log('[probe] ---');

const user = `The agent last said:\n\n${lastTurn}\n\nSummary:`;
console.log('[probe] LINK 2 running claude --print --model haiku …');
const res = await runMicro(binary, SYSTEM, user, 'haiku');
console.log(`[probe] LINK 2 turn-summary → ok=${res.ok} ms=${res.ms}`);
if (!res.ok) {
  console.log(`[probe] LINK 2 ERROR: ${res.error}`);
  process.exit(0);
}
console.log('[probe] --- SUMMARY (what would be relayed to Slack) ---');
console.log(res.text);
console.log('[probe] ---');
console.log(`[probe] summary length = ${res.text.length} chars`);
