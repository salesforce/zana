#!/usr/bin/env node
/** Isolated enrollment adapted from BB machine-enrollment.ts. See NOTICE.md. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function originOf(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use an HTTPS Connect address without a path');
  return url.origin;
}
export function atomicWrite(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(temporary, path); }
  finally { rmSync(temporary, { force: true }); }
}
function readJson(path) {
  if (lstatSync(path).isSymbolicLink() || statSync(path).size > 8192) throw new Error('Invalid saved enrollment');
  return JSON.parse(readFileSync(path, 'utf8'));
}
export function validateGrant(value, accountUrl, expectedServerId) {
  if (!value || typeof value !== 'object' || ['serverId', 'instanceId', 'hostId', 'machineId'].some(key => !uuid(value[key])) ||
      !/^[\w-]{43}$/.test(value.credential) || !/^zcde_[\w-]{24}$/.test(value.enrollToken) || value.accountUrl !== accountUrl ||
      value.serverId !== expectedServerId || !Number.isFinite(value.expiresAt)) throw new Error('Invalid machine enrollment response');
  originOf(value.serverUrl);
  return value;
}
export async function boundedResponse(response, cap) {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Connect returned ${response.status}; retry with the same command or generate a new machine code`); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('Empty Connect response');
  const chunks = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > cap) { await reader.cancel(); throw new Error('Connect response too large'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
/** A published identity is never replaced by another machine or product instance. */
export function assertCompatible(dataDir, grant, replaceEnrollment = false) {
  if (existsSync(dataDir) && lstatSync(dataDir).isSymbolicLink()) throw new Error('Machine data directory must not be a symlink');
  const hostFile = join(dataDir, 'host.id');
  if (existsSync(hostFile) && (lstatSync(hostFile).isSymbolicLink() || (!replaceEnrollment && readFileSync(hostFile, 'utf8').trim() !== grant.hostId))) throw new Error('This installation belongs to another machine; generate a repair code for that machine');
  const accessFile = join(dataDir, 'connect-access.json');
  if (existsSync(accessFile)) {
    const prior = readJson(accessFile);
    if (!replaceEnrollment && ['serverId', 'instanceId', 'hostId'].some(key => prior[key] !== grant[key])) throw new Error('This installation belongs to another instance or machine');
  }
  const authFile = join(dataDir, 'auth.json');
  if (existsSync(authFile)) {
    const prior = readJson(authFile);
    if (!replaceEnrollment && (prior.hostId !== grant.hostId || !prior.serverUrl || prior.serverUrl.replace(/\/$/, '') !== grant.serverUrl)) throw new Error('Existing machine credentials belong to another server');
  }
}
function acquire(path) {
  const owner = { pid: process.pid, nonce: randomUUID() };
  try { writeFileSync(path, JSON.stringify(owner), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const prior = readJson(path);
    if (!Number.isSafeInteger(prior.pid) || prior.pid < 2) throw new Error('Invalid enrollment lock');
    try { process.kill(prior.pid, 0); throw new Error('Another enrollment is in progress'); }
    catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
    // Serialize stale-lock recovery as well; a second reaper must not unlink
    // the replacement lock acquired by the first process.
    const recovery = `${path}.recovery`;
    writeFileSync(recovery, JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
    try {
      if (JSON.stringify(readJson(path)) !== JSON.stringify(prior)) throw new Error('Enrollment lock changed; retry');
      rmSync(path);
      writeFileSync(path, JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
    } finally { rmSync(recovery, { force: true }); }
  }
  return () => { if (existsSync(path) && readJson(path).nonce === owner.nonce) rmSync(path); };
}

export async function installMachine({ accountUrl, code, serverId, replaceEnrollment = false, home = homedir(), fetcher = fetch, execute = runInstaller }) {
  accountUrl = originOf(accountUrl);
  code = String(code ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (!/^[0-9A-F]{32}$/.test(code) || !uuid(serverId)) throw new Error('Use the complete machine command from Settings → Machines');
  const root = join(home, '.zcc-machines');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (lstatSync(root).isSymbolicLink() || realpathSync(root) !== join(realpathSync(home), '.zcc-machines')) throw new Error('Machine installation root must be a private directory');
  const attempts = join(root, 'pairing'); mkdirSync(attempts, { recursive: true, mode: 0o700 });
  if (lstatSync(attempts).isSymbolicLink()) throw new Error('Invalid pairing directory');
  const attemptsOnDisk = readdirSync(attempts);
  if (attemptsOnDisk.length > 1000) throw new Error('Too many saved pairing attempts; finish or remove expired attempts before retrying');
  for (const name of attemptsOnDisk) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const pending = join(attempts, name);
    if (!existsSync(`${pending}.lock`) && statSync(pending).mtimeMs < Date.now() - 24 * 60 * 60_000) rmSync(pending);
  }
  const id = createHash('sha256').update(`${accountUrl}:${serverId}:${code}`).digest('hex');
  const file = join(attempts, `${id}.json`), release = acquire(`${file}.lock`);
  try {
    if (!existsSync(file)) atomicWrite(file, { attemptSecret: randomBytes(32).toString('base64url'), createdAt: Date.now() });
    const attempt = readJson(file);
    if (!/^[\w-]{43}$/.test(attempt.attemptSecret)) throw new Error('Invalid saved pairing attempt');
    let grant = attempt.grant;
    if (!grant) {
      const response = await fetcher(`${accountUrl}/api/connect/hosts/redeem`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, attemptSecret: attempt.attemptSecret }) });
      grant = validateGrant(JSON.parse((await boundedResponse(response, 8192)).toString('utf8')), accountUrl, serverId);
      atomicWrite(file, { ...attempt, grant });
    }
    validateGrant(grant, accountUrl, serverId);
    const dataDir = join(root, grant.instanceId);
    assertCompatible(dataDir, grant, replaceEnrollment);
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const releaseInstall = acquire(join(dataDir, 'install.lock'));
    try {
      assertCompatible(dataDir, grant, replaceEnrollment);
      const response = await fetcher(`${grant.serverUrl}/install.sh`, { redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'x-zcc-machine-credential': grant.credential } });
      const script = await boundedResponse(response, 128 * 1024);
      const installer = join(dataDir, `install-${randomUUID()}.sh`);
      const { enrollToken, expiresAt, accountUrl: unused, ...access } = grant;
      atomicWrite(join(dataDir, 'connect-access.json'), access);
      atomicWrite(join(dataDir, 'connect-enroll.json'), { hostId: grant.hostId, enrollToken, expiresAt });
      const header = join(dataDir, `headers-${randomUUID()}`);
      try {
        writeFileSync(header, `x-zcc-machine-credential: ${grant.credential}\n`, { mode: 0o600, flag: 'wx' });
        writeFileSync(installer, script, { mode: 0o600, flag: 'wx' });
        const env = { ...process.env, HOME: home, ZCC_DATA_DIR: dataDir, ZCC_CONNECT_HEADER_FILE: header, ZCC_CONNECT_INSTANCE_ID: grant.instanceId };
        delete env.ZCC_HOST_REPLACE_ENROLLMENT;
        await execute(installer, env, ['--host-id', grant.hostId, '--server', grant.serverUrl, ...(replaceEnrollment ? ['--replace-enrollment'] : [])]);
        rmSync(file, { force: true });
        return { hostId: grant.hostId, serverId, serverUrl: grant.serverUrl, dataDir };
      } finally { rmSync(header, { force: true }); rmSync(installer, { force: true }); }
    } finally { releaseInstall(); }
  } finally { release(); }
}
export function runInstaller(file, env, args, { timeoutMs = 10 * 60_000, killGraceMs = 2000, spawnProcess = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess('/bin/sh', [file, ...args], { env, stdio: 'inherit', detached: true });
    let timedOut = false;
    let killTimer;
    const signalGroup = signal => { if (child.pid) { try { process.kill(-child.pid, signal); } catch {} } };
    const timer = setTimeout(() => {
      timedOut = true;
      signalGroup('SIGTERM');
      killTimer = setTimeout(() => signalGroup('SIGKILL'), killGraceMs);
    }, timeoutMs);
    child.once('error', error => { clearTimeout(timer); clearTimeout(killTimer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (timedOut) signalGroup('SIGKILL');
      clearTimeout(killTimer);
      code === 0 && !timedOut ? resolve() : reject(new Error(`Machine installation ${timedOut ? 'timed out' : 'failed'}; retry the same command`));
    });
  });
}
export async function main(args, install = installMachine, io = process) {
  try {
    const values = new Map();
    const replaceEnrollment = args.includes('--replace-enrollment');
    if (args.filter(arg => arg === '--replace-enrollment').length > 1) throw new Error('Duplicate --replace-enrollment');
    args = args.filter(arg => arg !== '--replace-enrollment');
    if (args.length !== 6) throw new Error('Expected --account, --code and --server-id');
    for (let i = 0; i < args.length; i += 2) {
      if (!['--account', '--code', '--server-id'].includes(args[i]) || values.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Expected --account, --code and --server-id');
      values.set(args[i], args[i + 1]);
    }
    await install({ accountUrl: values.get('--account'), code: values.get('--code'), serverId: values.get('--server-id'), replaceEnrollment });
    io.stdout.write('Machine connected to your shared Zana.\n');
    return 0;
  } catch (error) { io.stderr.write(`${error instanceof Error ? error.message : 'Machine installation failed'}\n`); return 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2));
