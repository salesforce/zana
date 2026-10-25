/** Repeatable sandbox-only smoke through the installed Salesforce family/workbench APIs. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
const execute = promisify(execFile);

export function validateSmokeTarget(context, expectedOrg, expectedProject) {
  assert(expectedOrg, 'Pass --org with the expected sandbox alias.');
  assert(expectedProject, 'Pass --project with the expected registered project id.');
  assert.equal(context.projectId, expectedProject, 'The CLI is attached to another project.');
  assert.equal(context.selectedAlias, expectedOrg, 'The selected org changed. Select the intended sandbox in Salesforce first.');
  assert.equal(context.orgs?.find(org => org.alias === expectedOrg)?.kind, 'sandbox', 'This smoke suite requires a known sandbox.');
}

export async function runAgentforceSmoke({ action, agent, expectedOrg, expectedProject, agentPath }) {
  assert(typeof agentPath === 'string' && /\.(agent|afscript)$/i.test(agentPath), 'Pass --agent with a project-relative Agent Script path.');
  const context = await action('context.status', {});
  validateSmokeTarget(context, expectedOrg, expectedProject);
  const read = await action('files.read', { path: agentPath });
  assert(read.ok && read.file?.content, read.error || 'Could not read the agent.');
  const diagnostics = await agent({ action: 'diagnose', path: agentPath, query: 'diagnostics' });
  assert(diagnostics.ok, diagnostics.error || 'Diagnostics failed.');
  assert(Array.isArray(diagnostics.data?.diagnostics), 'No diagnostic evidence returned.');
  assert(!diagnostics.data.diagnostics.some(d => d.severity === 'error'), 'Agent has error diagnostics.');
  const compiled = await agent({ action: 'compile', path: agentPath });
  assert(compiled.ok, compiled.error || 'Compile failed.');
  // Check again immediately before opening the session; never change the selected target.
  validateSmokeTarget(await action('context.status', {}), expectedOrg, expectedProject);
  let id;
  try {
    const start = await action('studio.start', { engine: 'preview', path: agentPath, source: read.file.content, scenario: { persona: 'A customer testing the Studio.', goal: 'Understand supported help.', opening: 'Hello. What can you help me with?', criteria: 'Stay within scope.', maxTurns: 2 } });
    id = start.data?.id;
    assert(start.ok && id, start.error || 'Simulate did not return a session.');
    assert.equal(start.data.orgAlias, expectedOrg, 'The session started on another org.');
    let last;
    for (const text of ['Hello. What can you help me with?', 'What information would you need from me?']) {
      const reply = await action('studio.send', { id, text });
      last = reply.data;
      assert(reply.ok && !last?.failed && last?.turns?.at(-1)?.role === 'agent' && last.turns.at(-1).text?.trim(), reply.error || 'A conversation turn failed.');
    }
    assert.equal(last.turns.filter(t => t.role === 'user').length, 2);
    assert.equal(last.turns.filter(t => t.role === 'agent').length, 2);
    const trace = await action('preview.trace', { id, planId: last.turns.at(-1).planId, path: agentPath });
    assert(trace.ok && trace.data?.available && trace.data.steps?.length, trace.error || trace.data?.reason || 'Runtime trace unavailable.');
    return { ok: true, org: expectedOrg, projectId: expectedProject, runId: id, turns: 2, traceSteps: trace.data.steps.length, latencyMs: last.turns.filter(t => t.role === 'agent').map(t => t.latencyMs ?? null), checks: ['diagnostics', 'compile', 'two-turn Simulate', 'runtime trace', 'session cleanup'] };
  } finally {
    if (id) { const ended = await action('studio.end', { id }); assert(ended.ok, ended.error || 'Session cleanup failed.'); }
  }
}

export async function smokeCli(kind, name, input, command = execute) {
  try {
    const { stdout } = await command('zcc', ['sf', kind, name, '--input', JSON.stringify(input), '--json'], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (error) {
    // execFile's default error includes argv (which may contain agent source). Never print it.
    let reply;
    try { reply = JSON.parse(error.stdout); } catch { /* transport failure */ }
    throw Error(reply?.error || `${name} failed or timed out; no successful smoke result was recorded.`);
  }
}

export async function smokeMain(argv, cli = smokeCli, stdout = process.stdout, stderr = process.stderr) {
  const flag = name => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
  try {
    const result = await runAgentforceSmoke({ expectedOrg: flag('--org'), expectedProject: flag('--project'), agentPath: flag('--agent'), action: (name, input) => cli('action', name, input), agent: input => cli('tool', 'sf_agent', input) });
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`Agentforce smoke FAILED: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await smokeMain(process.argv.slice(2));
