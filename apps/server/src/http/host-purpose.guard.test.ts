import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => readFileSync(join(src, relative), 'utf8');

describe('host purpose is display metadata, never authority', () => {
  it.each([
    'http/host-internal.ts',
    'http/host-hub.ts',
    '../../host-daemon/src/server-connection.ts'
  ])('%s never reads purpose', (file) => {
    const source = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(source).not.toMatch(/\.purpose\b|purpose_kind|purposeKind|'plugin-link'/);
  });
});

describe('execution-only consumers list execution hosts', () => {
  it.each([
    'http/product-api.ts',
    'http/thread-create.ts',
    'services/launch/cli-discovery.ts',
    'services/threads/conversation-create.ts',
    'services/threads/spawn-environment-provision.ts',
    'services/previews/preview-service.ts',
    'services/skills/cli-skills.ts',
    'services/hosts/host-public.ts'
  ])('%s does not use the unfiltered listHosts', (file) => {
    expect(read(file)).not.toMatch(/\blistHosts\(/);
  });
});
