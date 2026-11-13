import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** User-scope servers seeded into the isolated HOME's `.claude.json`. */
export const USER_ALLOWED = 'mcp-alpha';
export const USER_BLOCKED = 'mcp-beta';
/** Carries env + headers: the sanitizer strips them and the launch warns. */
export const USER_CREDENTIALED = 'mcp-cred';
export const CRED_SECRET = 'SECRET-TOKEN-VALUE-1234';
/** Allowlisted by a persona but defined nowhere. */
export const MISSING_SERVER = 'mcp-not-installed';

function writeFile(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/**
 * Seed the isolated HOME's Claude user config with three non-secret stdio servers and one
 * credentialed server. Only writes under `home`; never the real user's config.
 */
export function seedMcpInventory(home: string): void {
  writeFile(join(home, '.claude.json'), JSON.stringify({
    mcpServers: {
      [USER_ALLOWED]: { command: 'node', args: ['alpha.js'] },
      [USER_BLOCKED]: { command: 'node', args: ['beta.js'] },
      [USER_CREDENTIALED]: {
        command: 'node', args: ['cred.js'],
        env: { API_TOKEN: CRED_SECRET }, headers: { Authorization: `Bearer ${CRED_SECRET}` }
      }
    }
  }));
}

/**
 * Fake CLI `claude` (PTY path). Records argv plus the contents of the `--mcp-config` file at
 * start, because Zana deletes its per-session file on exit. Writes `argv-<pid>.json` into cwd.
 */
export const cliMcpStub = String.raw`
const fs = require('node:fs');
if (process.argv.includes('--version')) { console.log('2.1.316 (Claude Code)'); process.exit(0); }
const argv = process.argv.slice(2);
let mcpConfig = null;
const i = argv.indexOf('--mcp-config');
if (i >= 0) {
  const v = argv[i + 1];
  try { mcpConfig = JSON.parse(v.trim().startsWith('{') ? v : fs.readFileSync(v, 'utf8')); } catch (e) { mcpConfig = { error: String(e) }; }
}
fs.writeFileSync(process.cwd() + '/argv-' + process.pid + '.json', JSON.stringify({ argv, mcpConfig }));
console.log('MCP_ALLOWLIST_STUB_READY');
setInterval(() => {}, 1000);
`;

/**
 * Fake Modern (Claude Agent SDK) `claude`. Per spawned process it logs argv, the isolated
 * `CLAUDE_CONFIG_DIR`'s `.claude.json` `mcpServers` (read at start, before cleanup) and every
 * stdin message, so the server set the session was handed is observable.
 */
export function modernMcpFake(logs: string, nodePath: string): string {
  return `#!${nodePath}
const fs = require('node:fs');
const { createInterface } = require('node:readline');
if (process.argv.includes('--version')) { console.log('2.1.316 (Claude Code)'); process.exit(0); }
const log = ${JSON.stringify(logs)} + '/' + process.pid + '.jsonl';
const write = (kind, value) => fs.appendFileSync(log, JSON.stringify({ kind, value }) + '\\n');
let seeded = null;
try {
  const dir = process.env.CLAUDE_CONFIG_DIR;
  if (dir) seeded = JSON.parse(fs.readFileSync(dir + '/.claude.json', 'utf8'));
} catch (e) { seeded = null; }
write('argv', { argv: process.argv.slice(2), configDir: process.env.CLAUDE_CONFIG_DIR || null, threadId: process.env.ZCC_THREAD_ID || null, seededServers: seeded && seeded.mcpServers ? Object.keys(seeded.mcpServers) : null });
const MODELS = ['default:Sonnet 5:claude-sonnet-5','sonnet:Sonnet 5:claude-sonnet-5','haiku:Haiku 4.5:claude-haiku-4-5','opus:Opus 5.5:claude-opus-5-5'].map(r => { const [value, displayName, resolvedModel] = r.split(':'); return { value, displayName, resolvedModel, description: displayName, supportedEffortLevels: ['low','medium','high'] }; });
const out = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  write('in', msg);
  if (msg.type === 'control_request') {
    out({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id,
      response: msg.request.subtype === 'initialize' ? { commands: [], agents: [], models: MODELS, output_style: 'default', available_output_styles: ['default'], account: {} } : {} } });
  } else if (msg.type === 'user') {
    out({ type: 'system', subtype: 'init', session_id: 'fake-mcp-session', skills: [], plugins: [], mcp_servers: [], tools: [], model: 'fake', cwd: process.cwd(), permissionMode: 'default', slash_commands: [], apiKeySource: 'none' });
    out({ type: 'assistant', session_id: 'fake-mcp-session', message: { id: 'm1', type: 'message', role: 'assistant', model: 'fake', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } });
    out({ type: 'result', subtype: 'success', is_error: false, session_id: 'fake-mcp-session', result: 'ok', duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } });
  }
});
`;
}
