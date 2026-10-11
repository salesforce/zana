import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineRpcContract } from '../rpc-contract.js';
import { experimental_defineHostEntry } from '../host-contract.js';
import { experimental_createHostEntryHarness } from './host.js';

const contract = defineRpcContract({
  paths: { input: z.object({}).strict(), output: z.unknown() },
});
const entry = experimental_defineHostEntry({
  contract,
  handlers: { paths: async (_input, context) => context.experimental_paths },
});

describe('host entry harness thread-storage root', () => {
  it('defaults the thread-storage root to null so handlers must cope without one', async () => {
    const harness = experimental_createHostEntryHarness(entry);
    expect(await harness.experimental_call('paths', {})).toMatchObject({ threadStorageRoot: null });
    await harness.experimental_dispose();
  });

  it('lets a test supply the thread-storage root', async () => {
    const harness = experimental_createHostEntryHarness(entry, {
      experimental_paths: {
        dataDir: '/test/data',
        tempDir: '/test/temp',
        threadStorageRoot: '/test/data/thread-storage',
      },
    });
    expect(await harness.experimental_call('paths', {})).toMatchObject({
      dataDir: '/test/data',
      threadStorageRoot: '/test/data/thread-storage',
    });
    await harness.experimental_dispose();
  });
});
