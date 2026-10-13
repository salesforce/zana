import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true } });

// Run each actual CLI-injected hook through the PTY, main's loopback hook
// listener, authoritative main-owned identity, runtime policy transport, and
// plugin policy. The retired product terminal policy route remains unavailable.
const stub = String.raw`
const {spawnSync} = require('node:child_process');
const {writeFileSync} = require('node:fs');
const {createInterface} = require('node:readline');
if (process.argv.includes('--version')) { console.log(process.argv[1].includes('claude-') ? '2.1.296' : 'codex-cli 0.159.3'); process.exit(0); }
const settingsIndex = process.argv.indexOf('--settings');
const isClaude = settingsIndex >= 0;
const commands = isClaude ? JSON.parse(process.argv[settingsIndex + 1]).hooks.PreToolUse.flatMap(h => h.hooks.map(h => h.command)).filter(c => c.includes('ZCC_NATIVETOOL_URL'))
  : process.argv.slice(2).filter(a => a.startsWith('hooks.PreToolUse='))
  .flatMap(a => [...a.matchAll(/command=("(?:[^"\\]|\\.)*")/g)].map(m => JSON.parse(m[1])));
if (!commands.length) throw new Error('Missing native policy hook');
console.log('POLICY_READY');
createInterface({input:process.stdin}).on('line', line => {
  const valid = line.trim() === 'write';
  const input = {hook_event_name:'PreToolUse', ...(isClaude ? {prompt_id:'prompt-probe'} : {turn_id:'turn-probe'}),
    ...(valid ? {tool_use_id:'call-probe'} : {}), tool_name:'Write', tool_input:{path:'marker.txt'}};
  const result = spawnSync('/bin/sh', ['-c', commands[0]], {
    input:JSON.stringify(input), timeout:6000, stdio:['pipe','pipe','pipe']
  });
  const decision = JSON.parse(result.stdout.toString()).hookSpecificOutput.permissionDecision;
  if (decision === 'allow') writeFileSync(valid ? 'marker.txt' : 'invalid.txt', 'POLICY_ALLOWED');
  writeFileSync(valid ? 'write-result.json' : 'invalid-result.json', JSON.stringify({decision,exit:result.status}));
  console.log('POLICY_RESULT:' + decision);
});
`;

for (const profile of ['codex', 'claude'] as const) {
test(`${profile} native CLI policy reaches the registered desktop session and fails closed for malformed hooks`, async ({ app, events }) => {
  const { window, home } = app;
  const dir = join(home, 'native-policy-project');
  mkdirSync(dir);
  const binary = join(dir, `${profile}-stub.cjs`);
  writeFileSync(binary, `#!${process.execPath}\n${stub}`);
  chmodSync(binary, 0o755);
  let sessionId: string | undefined;
  try {
    const projectId = await window.evaluate(async path => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message);
      return result.value.id;
    }, dir);
    await window.evaluate(({ profile, binary }) => window.cc.config.set({ [`${profile}Binary`]: binary }), { profile, binary });
    sessionId = await window.evaluate(async ({ projectId, profile }) => {
      const result = await window.cc.terminals.create({ projectId, profile, cols: 100, rows: 32 });
      if (!result.ok) throw new Error(result.message);
      return result.value.id;
    }, { projectId, profile });
    await events.waitForEvent(event => event.channel === 'terminals:onData'
      && JSON.stringify(event.args).includes('POLICY_READY'), 15000);
    const send = async (command: string) => window.evaluate(({ id, command }) =>
      window.cc.terminals.write(id, command + '\r'), { id: sessionId!, command });
    await send('write');
    await expect.poll(() => existsSync(join(dir, 'write-result.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'write-result.json'), 'utf8'))).toEqual({ decision: 'allow', exit: 0 });
    expect(readFileSync(join(dir, 'marker.txt'), 'utf8')).toBe('POLICY_ALLOWED');
    await send('invalid');
    await expect.poll(() => existsSync(join(dir, 'invalid-result.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'invalid-result.json'), 'utf8'))).toEqual({ decision: 'deny', exit: 0 });
    expect(existsSync(join(dir, 'invalid.txt'))).toBe(false);
    const policy = (id: string) => window.evaluate(async id => {
      const response = await fetch(`/api/v1/terminals/${id}/tool-policy`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ invocationId: 'call', toolName: 'Write', input: {} })
      });
      return response.status;
    }, id);
    expect(await policy('unknown-session')).toBe(404);
    expect(await policy(sessionId)).toBe(404);
    await window.evaluate(id => window.cc.terminals.close(id), sessionId);
    expect(await policy(sessionId)).toBe(404);
    sessionId = undefined;
  } finally {
    if (sessionId) await window.evaluate(id => window.cc.terminals.close(id), sessionId).catch(() => undefined);
  }
});
}
