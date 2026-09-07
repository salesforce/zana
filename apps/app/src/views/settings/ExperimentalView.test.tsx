import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { ExperimentalView } from './ExperimentalView.js';

const base: AppConfig = {
  version: 1,
  theme: 'system',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null,
  worktreeIsolationDefault: true
};

describe('Experimental voice settings', () => {
  it('treats Codex login as the default and OpenAI as an optional fallback', () => {
    const html = renderToStaticMarkup(
      <ExperimentalView
        config={{ ...base, voiceInputEnabled: true }}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn()}
      />
    );
    expect(html).toContain('codex login');
    expect(html).toContain('optional fallback');
    expect(html).toContain('Fallback transcription model');
    expect(html).toContain('gpt-transcribe');
    expect(html).toContain('OPENAI_API_KEY');
  });

  it('hides fallback fields until voice input is enabled', () => {
    const html = renderToStaticMarkup(
      <ExperimentalView
        config={base}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn()}
      />
    );
    expect(html).toContain('Voice input (dictation)');
    expect(html).not.toContain('Fallback transcription model');
  });
});

describe('Experimental CLI Agent host catalog', () => {
  it('offers an off-by-default toggle for the host execution-options catalog', () => {
    const html = renderToStaticMarkup(
      <ExperimentalView
        config={base}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn()}
      />
    );
    expect(html).toContain('CLI Agent host catalog');
    expect(html).toContain('execution-options');
    expect(html).toContain('local install list');
  });
});

describe('Experimental CLI Agent remote tools', () => {
  it('hides the CLI remote-tools toggle (CLI Agent is Remote host only)', () => {
    const html = renderToStaticMarkup(
      <ExperimentalView
        config={{ ...base, cliRemoteToolProxyEnabled: true }}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn()}
      />
    );
    expect(html).not.toContain('CLI Agent remote tools');
    expect(html).not.toContain('ssh -t');
  });
});
