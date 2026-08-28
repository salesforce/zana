import { errResult, type CliResult } from '../cli-result.js';
import { flagValue } from '../flag-parse.js';
import { productRequest, renderOrJson, type ProductHttpDeps } from '../product-http.js';

interface SkillRow {
  pluginId?: string;
  name?: string;
  skillNames?: string[];
}

export async function runSkillCommand(
  subcommand: string | undefined,
  rest: string[],
  json: boolean,
  deps?: ProductHttpDeps
): Promise<CliResult> {
  if (!subcommand || subcommand === 'list' || subcommand === 'ls') {
    const listed = await productRequest<{ pluginSkills?: SkillRow[] }>(
      'GET',
      '/api/v1/plugins/contributions',
      { deps }
    );
    if (!listed.ok) return listed.result;
    const rows = listed.data.pluginSkills ?? [];
    if (json) return renderOrJson(true, rows, '');
    if (rows.length === 0) return renderOrJson(false, rows, 'No plugin skills\n');
    const lines = rows.flatMap((row) =>
      (row.skillNames ?? []).map((name) => `${row.pluginId ?? '?'}\t${name}\t${row.name ?? ''}`)
    );
    return renderOrJson(false, rows, `${lines.join('\n')}\n`);
  }

  if (subcommand === 'show' || subcommand === 'files') {
    const id = rest[0];
    if (!id) return errResult(`skill ${subcommand} requires <skill-id>`, 2);
    const listed = await productRequest<{ pluginSkills?: SkillRow[] }>(
      'GET',
      '/api/v1/plugins/contributions',
      { deps }
    );
    if (!listed.ok) return listed.result;
    const rows = listed.data.pluginSkills ?? [];
    const match = rows.find((row) =>
      row.pluginId === id ||
      row.name === id ||
      (row.skillNames ?? []).includes(id)
    );
    if (!match) return errResult(`skill not found: ${id}`, 3);
    return renderOrJson(json, match, `${match.pluginId}\t${(match.skillNames ?? []).join(', ')}\n`);
  }

  if (subcommand === 'cli-skills-status') {
    const hostId = flagValue(rest, '--machine') ?? flagValue(rest, '--host');
    const status = await productRequest<unknown>('GET', '/api/v1/system/cli-skills', {
      deps,
      query: hostId ? { hostId } : undefined
    });
    if (!status.ok) return status.result;
    return renderOrJson(json, status.data, `${JSON.stringify(status.data, null, 2)}\n`);
  }

  if (subcommand === 'install-cli-skills') {
    const hostId = flagValue(rest, '--machine') ?? flagValue(rest, '--host');
    const installed = await productRequest<unknown>('POST', '/api/v1/system/cli-skills/install', {
      deps,
      body: { hostIds: hostId ? [hostId] : [] }
    });
    if (!installed.ok) return installed.result;
    return renderOrJson(json, installed.data, `${JSON.stringify(installed.data, null, 2)}\n`);
  }

  return errResult(
    `unknown skill command '${subcommand}'. Try list, show, files, cli-skills-status, install-cli-skills.`,
    2
  );
}
