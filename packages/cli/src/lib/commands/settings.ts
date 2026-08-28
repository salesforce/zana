import { errResult, type CliResult } from '../cli-result.js';
import { productRequest, renderOrJson, type ProductHttpDeps } from '../product-http.js';

export async function runSettingsCommand(
  subcommand: string | undefined,
  rest: string[],
  json: boolean,
  deps?: ProductHttpDeps
): Promise<CliResult> {
  if (!subcommand || subcommand === 'show') {
    const config = await productRequest<{ config?: unknown }>('GET', '/api/v1/config', { deps });
    if (!config.ok) return config.result;
    const value = config.data.config ?? config.data;
    return renderOrJson(json, value, `${JSON.stringify(value, null, 2)}\n`);
  }

  if (subcommand === 'general' || subcommand === 'experiment' || subcommand === 'appearance') {
    const key = rest[0];
    const raw = rest.slice(1).join(' ').trim();
    if (!key || raw === '') return errResult(`settings ${subcommand} requires <key> <value>`, 2);
    let parsed: unknown = raw;
    if (raw === 'true') parsed = true;
    else if (raw === 'false') parsed = false;
    else if (/^-?\d+(\.\d+)?$/.test(raw)) parsed = Number(raw);
    const patched = await productRequest<{ config?: unknown }>('PATCH', '/api/v1/config', {
      deps,
      body: { [key]: parsed }
    });
    if (!patched.ok) return patched.result;
    const value = patched.data.config ?? patched.data;
    return renderOrJson(json, value, `${JSON.stringify(value, null, 2)}\n`);
  }

  return errResult(
    `unknown settings command '${subcommand}'. Try show, general, experiment, appearance.`,
    2
  );
}
