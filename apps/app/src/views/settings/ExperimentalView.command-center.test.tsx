// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(cleanup);

describe('Experimental Command Center toggle', () => {
  it('is unchecked by default and enables companion mode on toggle', () => {
    const onUpdate = vi.fn();
    render(<ExperimentalView config={base} onConfigDraft={vi.fn()} onUpdate={onUpdate} />);
    const box = screen.getByLabelText('Enable Command Center mode') ;
    expect(box.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(box);
    expect(onUpdate).toHaveBeenCalledWith({ companionEnabled: true });
  });

  it('renders checked when companionEnabled is true and can be disabled', () => {
    const onUpdate = vi.fn();
    render(<ExperimentalView config={{ ...base, companionEnabled: true }} onConfigDraft={vi.fn()} onUpdate={onUpdate} />);
    const box = screen.getByLabelText('Enable Command Center mode') ;
    expect(box.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(box);
    expect(onUpdate).toHaveBeenCalledWith({ companionEnabled: false });
  });
});
