import { errResult, type CliResult } from '../cli-result.js';
import { flagValue } from '../flag-parse.js';
import { productRequest, renderOrJson, type ProductHttpDeps } from '../product-http.js';

export async function runFileCommand(
  subcommand: string | undefined,
  rest: string[],
  json: boolean,
  deps?: ProductHttpDeps
): Promise<CliResult> {
  if (subcommand !== 'read') {
    return errResult('file requires a verb. Try read --host --json.', 2);
  }
  const path = rest.find((token) => !token.startsWith('--')) ?? flagValue(rest, '--path');
  const hostId = flagValue(rest, '--host');
  const rootPath = flagValue(rest, '--root');
  if (!path) return errResult('file read requires a path', 2);
  if (!hostId) return errResult('file read requires --host', 2);
  const result = await productRequest<{
    content?: string;
    contentEncoding?: string;
    encoding?: string;
  }>('POST', '/api/v1/files/read', {
    deps,
    body: { hostId, path, ...(rootPath ? { rootPath } : {}) }
  });
  if (!result.ok) return result.result;
  if (json) return renderOrJson(true, result.data, '');
  const content = result.data.content ?? '';
  const encoding = result.data.contentEncoding ?? result.data.encoding ?? 'utf8';
  return {
    exitCode: 0,
    stdout: encoding === 'utf8' ? (content.endsWith('\n') ? content : `${content}\n`) : `${content}\n`
  };
}
