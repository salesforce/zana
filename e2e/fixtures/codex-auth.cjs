// Fake installed Codex. No OS credential storage or network access.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const home = process.env.CODEX_HOME;
if (!home || process.cwd() !== fs.realpathSync(home) ||
    JSON.stringify(process.argv.slice(2)) !== JSON.stringify(['-c', 'model_provider="openai"', 'app-server'])) process.exit(2);
const mode = fs.readFileSync(path.join(home, 'mode'), 'utf8');
fs.appendFileSync(path.join(home, 'calls.ndjson'), JSON.stringify({
  pid: process.pid, cwd: process.cwd(), home: process.env.HOME, codexHome: home,
  outputMode: fs.fstatSync(1).mode & 0o777
}) + '\n');
if (mode === 'exit') { process.stderr.write('synthetic-private-error'); process.exit(17); }
if (mode === 'timeout') setInterval(() => {}, 1000);
const reply = (id, result) => process.stdout.write(JSON.stringify({ id, result }) + '\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (mode === 'timeout') return;
  if (request.method === 'initialize') {
    if (mode === 'init-error') process.stdout.write(JSON.stringify({ id: request.id, error: { message: 'synthetic-private-error' } }) + '\n');
    else reply(request.id, {});
    return;
  }
  if (request.method === 'initialized') return;
  if (request.method !== 'getAuthStatus' || request.params.includeToken !== true || request.params.refreshToken !== false) process.exit(3);
  if (mode === 'error') { process.stdout.write(JSON.stringify({ id: request.id, error: { message: 'synthetic-private-error' } }) + '\n'); return; }
  if (mode === 'malformed') { process.stdout.write('synthetic-private-error\n'); return; }
  if (mode === 'invalid') { reply(request.id, []); return; }
  if (mode === 'missing') { reply(request.id, { authMethod: null, authToken: null, requiresOpenaiAuth: true }); return; }
  if (mode === 'no-token') { reply(request.id, { authMethod: 'chatgpt', authToken: null }); return; }
  if (mode === 'unsupported') { reply(request.id, { authMethod: 'agentIdentity', authToken: 'synthetic-private-token' }); return; }
  let authMethod = 'apikey';
  let authToken = 'synthetic-e2e-key';
  if (mode === 'chatgpt' || mode === 'chatgptAuthTokens') {
    authMethod = mode;
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    authToken = `${encode({ alg: 'none' })}.${encode({
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct_fixture' }, email: 'voice@example.com'
    })}.signature`;
  }
  // Put the usable credential beyond 8192 bytes to catch Electron pipe loss.
  const padding = 'x'.repeat(mode === 'overflow' ? 300 * 1024 : 32 * 1024);
  process.stdout.write(JSON.stringify({ method: 'fixture/notification', params: {} }) + '\n');
  reply(request.id, { padding, authMethod, authToken, requiresOpenaiAuth: true });
});
