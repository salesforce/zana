const { appendFileSync } = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline');

if (process.argv.includes('--version')) {
  console.log('2.1.296 (Claude Code)');
  process.exit(0);
}

const option = name => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : process.argv.find(arg => arg.startsWith(name + '='))?.slice(name.length + 1);
};
const sessionId = option('--session-id') ?? option('--resume') ?? randomUUID();
const permissionMode = option('--permission-mode') ?? 'default';
const pending = new Map();
let hooks = {};
let serial = 0;
let turns = Promise.resolve();
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
// Record every `--mcp-config` the SDK launched this CLI with, so a spec can read the servers Modern Claude received.
process.argv.forEach((arg, index) => {
  if (process.argv[index - 1] !== '--mcp-config') return;
  try {
    const raw = arg.trim().startsWith('{') ? arg : require('node:fs').readFileSync(arg, 'utf8');
    appendFileSync(join(process.cwd(), '.native-policy-mcp.jsonl'), raw.replace(/\n/g, ' ') + '\n', { mode: 0o600 });
  } catch { /* unreadable config: the spec asserts on the journal */ }
});
const journal = row => appendFileSync(join(process.cwd(), '.native-policy-provider.jsonl'), JSON.stringify(row) + '\n', { mode: 0o600 });

async function invokeHook(callbackId, input) {
  const requestId = `fixture-hook-${++serial}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('fixture SDK callback did not settle within 20 seconds'));
    }, 20_000);
    pending.set(requestId, { resolve, reject, timer });
    send({ type: 'control_request', request_id: requestId, request: {
      subtype: 'hook_callback', callback_id: callbackId, input, tool_use_id: input.tool_use_id
    } });
  });
}

async function turn(message) {
  const text = typeof message.message?.content === 'string'
    ? message.message.content : JSON.stringify(message.message?.content);
  const label = /NATIVE_POLICY:([\w-]+)/.exec(text)?.[1];
  send({ type: 'system', subtype: 'init', session_id: sessionId, uuid: randomUUID(), cwd: process.cwd(),
    tools: ['Bash'], mcp_servers: [], model: 'claude-sonnet-5', permissionMode, slash_commands: [], apiKeySource: 'fixture' });
  let reply = 'Native fixture standby';
  if (label) {
    const marker = `.native-policy-${label}.marker`;
    const command = `printf 'NATIVE_SIDE_EFFECT:${label}' > ${marker}`;
    const toolUseId = `fixture-bash-${randomUUID()}`;
    const input = { hook_event_name: 'PreToolUse', session_id: sessionId, cwd: process.cwd(),
      transcript_path: join(process.cwd(), '.fixture-transcript.jsonl'), permission_mode: permissionMode,
      tool_name: 'Bash', tool_input: { command, token: 'fixture-secret-must-be-redacted' }, tool_use_id: toolUseId };
    // Run the SDK's registered callbacks, never replace the bridge or policy answer.
    const callbacks = (hooks.PreToolUse ?? []).filter(row => !row.matcher || new RegExp(row.matcher).test('Bash'))
      .flatMap(row => row.hookCallbackIds);
    journal({ phase: 'attempt', label, sessionId, toolUseId, cwd: process.cwd(), callbacks, permissionMode });
    const outputs = [];
    const startedAt = Date.now();
    let failed;
    try {
      for (const callbackId of callbacks) outputs.push(await invokeHook(callbackId, input));
    } catch (error) { failed = String(error); }
    const denied = outputs.find(output => output?.hookSpecificOutput?.permissionDecision === 'deny');
    const ask = outputs.some(output => output?.hookSpecificOutput?.permissionDecision === 'ask');
    const reason = failed ?? denied?.hookSpecificOutput?.permissionDecisionReason;
    const decision = failed || denied ? 'deny' : ask ? 'ask' : 'allow';
    let exitCode = null;
    if (decision === 'allow') {
      const result = spawnSync('/bin/sh', ['-c', command], { cwd: process.cwd(), timeout: 5_000, encoding: 'utf8' });
      if (result.error) throw result.error;
      exitCode = result.status;
    }
    // Labels starting `settled-` also run the SDK's PostToolUse callbacks, as Claude does after a tool ends.
    if (decision === 'allow' && label.startsWith('settled-')) {
      const post = { hook_event_name: 'PostToolUse', session_id: sessionId, cwd: process.cwd(),
        transcript_path: input.transcript_path, permission_mode: permissionMode, tool_name: 'Bash',
        tool_input: input.tool_input, tool_response: { stdout: 'SETTLED_OUTPUT:' + label + ' token=fixture-secret-must-be-redacted ' + 'x'.repeat(6000), stderr: '', exit_code: exitCode },
        tool_use_id: toolUseId };
      const postCallbacks = (hooks.PostToolUse ?? []).filter(row => !row.matcher || new RegExp(row.matcher).test('Bash'))
        .flatMap(row => row.hookCallbackIds);
      let postFailed;
      try { for (const callbackId of postCallbacks) await invokeHook(callbackId, post); } catch (error) { postFailed = String(error); }
      journal({ phase: 'post', label, sessionId, toolUseId, callbacks: postCallbacks, failed: postFailed });
    }
    journal({ phase: 'settled', label, sessionId, toolUseId, decision, reason, outputs, exitCode, elapsedMs: Date.now() - startedAt });
    reply = `NATIVE_POLICY_RESULT:${label}:${decision}${reason ? ':' + reason : ''}`;
  }
  send({ type: 'assistant', session_id: sessionId, uuid: randomUUID(), parent_tool_use_id: null,
    message: { id: randomUUID(), type: 'message', role: 'assistant', model: 'claude-sonnet-5',
      content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 } } });
  send({ type: 'result', subtype: 'success', session_id: sessionId, uuid: randomUUID(), is_error: false,
    result: reply, duration_ms: 1, duration_api_ms: 0, num_turns: 1, total_cost_usd: 0,
    usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: {}, permission_denials: [] });
}

createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.type === 'control_response') {
    const call = pending.get(message.response?.request_id);
    if (!call) return;
    pending.delete(message.response.request_id);
    clearTimeout(call.timer);
    if (message.response.subtype === 'success') call.resolve(message.response.response);
    else call.reject(new Error(message.response.error));
  } else if (message.type === 'control_request') {
    const initialize = message.request.subtype === 'initialize';
    if (initialize) hooks = message.request.hooks ?? {};
    send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id,
      response: initialize ? { models: [{ value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet 5',
        description: 'Isolated native tool policy fixture', supportedEffortLevels: ['low', 'medium', 'high'] }], commands: [], agents: [] } : {} } });
  } else if (message.type === 'user') {
    turns = turns.then(() => turn(message)).catch(error => {
      console.error(error);
      process.exitCode = 1;
      process.stdin.destroy();
    });
  }
});
