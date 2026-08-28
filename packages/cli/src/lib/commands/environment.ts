import { errResult, type CliResult } from '../cli-result.js';
import { flagValue } from '../flag-parse.js';
import { productRequest, renderOrJson, type ProductHttpDeps } from '../product-http.js';

export async function runEnvironmentCommand(
  subcommand: string | undefined,
  rest: string[],
  json: boolean,
  deps?: ProductHttpDeps
): Promise<CliResult> {
  const id = rest[0];
  if (!id) return errResult('environment commands require <id>', 2);

  if (subcommand === 'status' || subcommand === 'show') {
    const status = await productRequest<unknown>(
      'GET',
      `/api/v1/environments/${encodeURIComponent(id)}/status`,
      { deps }
    );
    if (!status.ok) return status.result;
    return renderOrJson(json, status.data, `${JSON.stringify(status.data, null, 2)}\n`);
  }

  if (subcommand === 'diff' || subcommand === 'diff-files') {
    const path = subcommand === 'diff-files'
      ? `/api/v1/environments/${encodeURIComponent(id)}/diff/files`
      : `/api/v1/environments/${encodeURIComponent(id)}/diff`;
    const diff = await productRequest<unknown>('GET', path, {
      deps,
      query: { target: flagValue(rest, '--target') }
    });
    if (!diff.ok) return diff.result;
    return renderOrJson(json, diff.data, `${JSON.stringify(diff.data, null, 2)}\n`);
  }

  if (subcommand === 'pull-request') {
    const pr = await productRequest<unknown>(
      'GET',
      `/api/v1/environments/${encodeURIComponent(id)}/pull-request`,
      { deps }
    );
    if (!pr.ok) return pr.result;
    return renderOrJson(json, pr.data, `${JSON.stringify(pr.data, null, 2)}\n`);
  }

  return errResult(
    `unknown environment command '${subcommand}'. Try status, diff, diff-files, pull-request.`,
    2
  );
}
