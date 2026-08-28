#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const playgroundRoot = join(dirname(fileURLToPath(import.meta.url)), '../playground');
await build({ configFile: join(playgroundRoot, 'vite.config.ts') });
