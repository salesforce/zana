import { chmodSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

if (process.platform !== 'win32') {
  const output = join(process.cwd(), 'resources', 'scheduled-supervisor');
  execFileSync('cc', ['-O2', '-Wall', '-Werror', '-o', output, join(process.cwd(), 'resources', 'scheduled-supervisor.c')], { stdio: 'inherit' });
  if (existsSync(output)) chmodSync(output, 0o755);
}
