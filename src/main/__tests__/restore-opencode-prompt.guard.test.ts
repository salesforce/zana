import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('OpenCode restore prompt guard', () => {
  it('strips the original OpenCode prompt before persisting a restore request', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8');
    const refresh = source.slice(
      source.indexOf('function refreshRestoreCapability('),
      source.indexOf('const launchAuthorizationBySession')
    );
    expect(refresh).toContain('restoredExtraArgs(session.profile, capability.request.extraArgs)');
    expect(refresh).toContain('title: session.title');
    expect(refresh).toContain("extraArgs[index] === '--prompt'");
    expect(refresh).toContain("extraArgs[index].startsWith('--prompt=')");
  });
});
