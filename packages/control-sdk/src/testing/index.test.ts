import { describe, expect, it } from 'vitest';
import { makeFakeAgentBinary, makeFakeGenericHoldBinary, makeFakeOpenCodeBinary } from './index.js';
import { readFileSync } from 'node:fs';

describe('fake harness binaries', () => {
  it('writes an executable stub', () => {
    const binary = makeFakeAgentBinary({ sequence: 'work-then-idle' });
    try {
      const body = readFileSync(binary.path, 'utf8');
      expect(body).toContain('#!/bin/sh');
      expect(body).toContain('printf');
    } finally {
      binary.cleanup();
    }
  });

  it('OpenCode fixture exits 64 when --model rides with --agent', () => {
    const binary = makeFakeOpenCodeBinary();
    try {
      const body = readFileSync(binary.path, 'utf8');
      expect(body).toContain('exit 64');
      expect(body).toContain('--model');
      expect(body).toContain('--agent');
    } finally {
      binary.cleanup();
    }
  });

  it('generic hold answers --version', () => {
    const binary = makeFakeGenericHoldBinary();
    try {
      expect(readFileSync(binary.path, 'utf8')).toContain('--version');
    } finally {
      binary.cleanup();
    }
  });
});
