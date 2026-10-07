import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ToolkitRuntime } from './tool-provider-contract.js';

/** One optional dependency boundary. Built-in tools never import the toolkit. */
export function toolkitRuntimeLoader(moduleUrl = import.meta.url): () => Promise<ToolkitRuntime> {
  let loading: Promise<ToolkitRuntime> | undefined;
  return () => {
    loading ??= (async () => {
      const url = ['./toolkit-runtime/sdk.mjs', '../toolkit-runtime/sdk.mjs']
        .map(path => new URL(path, moduleUrl)).find(url => existsSync(fileURLToPath(url)));
      if (!url) throw Error('Salesforce toolkit runtime is missing. Rebuild or reinstall the Salesforce plugin.');
      return await import(/* @vite-ignore */ url.href) as ToolkitRuntime;
    })().catch(error => { loading = undefined; throw error; });
    return loading;
  };
}
