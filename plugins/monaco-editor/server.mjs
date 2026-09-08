import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import {
  confineToRoot,
  isBinaryBuffer,
  MAX_EDITABLE_BYTES,
  parseFileSource
} from './file-rpc.js';

function sha256Of(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

async function resolveLocalPath(zcc, source, filePath) {
  if (source.kind !== 'workspace' || !source.projectId) {
    throw Object.assign(new Error('This file is not a local project file'), { code: 'unsupported' });
  }
  const projects = await zcc.sdk.projects.list();
  const project = projects.find((row) => row.id === source.projectId);
  if (!project?.path) {
    throw Object.assign(new Error('This project has no local path'), { code: 'unsupported' });
  }
  return confineToRoot(project.path, filePath);
}

export default function plugin(zcc) {
  zcc.rpc.method('read', async (input) => {
    const file = parseFileSource(input);
    try {
      const abs = await resolveLocalPath(zcc, file.source, file.path);
      const stats = statSync(abs);
      if (stats.size > MAX_EDITABLE_BYTES) {
        return { kind: 'unsupported', reason: 'This file is too large to edit' };
      }
      const buffer = readFileSync(abs);
      if (isBinaryBuffer(buffer)) {
        return { kind: 'unsupported', reason: 'This file is not text' };
      }
      const content = buffer.toString('utf8');
      return { kind: 'text', content, sha256: sha256Of(content) };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'unsupported') {
        return { kind: 'unsupported', reason: error instanceof Error ? error.message : 'unsupported' };
      }
      throw error;
    }
  });

  zcc.rpc.method('write', async (input) => {
    const file = parseFileSource(input);
    if (typeof file.content !== 'string') throw new Error('content is required');
    try {
      const abs = await resolveLocalPath(zcc, file.source, file.path);
      if (file.expectedSha256) {
        let current = '';
        try {
          current = readFileSync(abs, 'utf8');
        } catch {
          current = '';
        }
        if (sha256Of(current) !== file.expectedSha256) {
          return { outcome: 'conflict', currentSha256: sha256Of(current) };
        }
      }
      writeFileSync(abs, file.content, 'utf8');
      return { outcome: 'written', sha256: sha256Of(file.content) };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'unsupported') {
        return { outcome: 'unsupported', reason: error instanceof Error ? error.message : 'unsupported' };
      }
      throw error;
    }
  });
}
