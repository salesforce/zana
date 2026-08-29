import { describe, expect, it } from 'vitest';
import { runMarketplaceCommand } from '../lib/plugin-commands.js';

describe('marketplace CLI', () => {
  it('requires a source for add, refresh, and remove', async () => {
    await expect(runMarketplaceCommand('/tmp', 'add', [], false)).resolves.toMatchObject({
      exitCode: 2,
      stderr: expect.stringMatching(/https-url \| git:url\[@ref\] \| path:dir/)
    });
    await expect(runMarketplaceCommand('/tmp', 'refresh', [], false)).resolves.toMatchObject({
      exitCode: 2
    });
    await expect(runMarketplaceCommand('/tmp', 'remove', [], false)).resolves.toMatchObject({
      exitCode: 2
    });
  });

  it('rejects an unknown subcommand', async () => {
    await expect(runMarketplaceCommand('/tmp', 'explode', [], false)).resolves.toMatchObject({
      exitCode: 2,
      stderr: expect.stringMatching(/unknown marketplace command/)
    });
  });
});
