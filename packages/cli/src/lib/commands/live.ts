import { errResult, type CliResult } from '../cli-result.js';
import { flagValue, hasFlag } from '../flag-parse.js';
import { resolveServerUrl, renderOrJson, type ProductHttpDeps } from '../product-http.js';
import { ProductHttpClient, cleanupRun, cleanupStale } from '@zana-ai/zcc-control';

export async function runLiveCommand(
  subcommand: string | undefined,
  rest: string[],
  json: boolean,
  dataDir: string,
  deps?: ProductHttpDeps
): Promise<CliResult> {
  if (subcommand !== 'cleanup') {
    return errResult('unknown live command. Try: zcc live cleanup [--stale|--tag <runId>]', 2);
  }
  const stale = hasFlag(rest, '--stale');
  const tag = flagValue(rest, '--tag');
  try {
    const http = new ProductHttpClient(resolveServerUrl(deps), {
      fetchImpl: deps?.fetchImpl,
      nowMs: deps?.nowMs,
      sleep: deps?.sleep
    });
    const result = stale || !tag
      ? await cleanupStale(http, dataDir)
      : await cleanupRun(http, dataDir, tag);
    return renderOrJson(json, result, `${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    return errResult(error instanceof Error ? error.message : String(error));
  }
}
