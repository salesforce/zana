import type { ServerResponse } from 'node:http';
import type { PluginSshIdentity } from '@zana-ai/zcc-plugin-sdk/server';
import type { ProductHttpContext } from './product-context.js';
import { SshPreparationError } from '../plugins/ssh-connection-providers.js';
import { HostBootstrapError, type HostBootstrapEvent } from '../services/hosts/host-bootstrap.js';

/** Foreground request boundary only. Internal/background repairHost callers stay noninteractive. */
export async function prepareSshConnection(
  ctx: ProductHttpContext,
  response: ServerResponse,
  remote: PluginSshIdentity,
  emit: (event: HostBootstrapEvent) => void
): Promise<boolean> {
  if (!ctx.plugins?.prepareSshConnection) return true;
  const controller = new AbortController();
  const closed = () => controller.abort();
  response.once('close', closed);
  let started = false;
  try {
    if (response.destroyed) controller.abort();
    await ctx.plugins.prepareSshConnection(remote, controller.signal, name => {
      started = true;
      emit({ type: 'stage', stage: 'prepare', status: 'running', limitMs: 360_000 });
      emit({ type: 'log', text: `Preparing connection with ${name}. Complete sign-in in your browser if requested…` });
    });
    controller.signal.throwIfAborted();
    if (started) emit({ type: 'stage', stage: 'prepare', status: 'passed' });
    return true;
  } catch (error) {
    if (controller.signal.aborted) return false;
    const message = error instanceof SshPreparationError || error instanceof HostBootstrapError
      ? error.message : 'Could not prepare the SSH connection. Check Plugins and retry.';
    emit({ type: 'stage', stage: 'prepare', status: 'failed', reason: message });
    emit({ type: 'error', code: 'connection_preparation_failed', message });
    return false;
  } finally {
    response.off('close', closed);
  }
}
