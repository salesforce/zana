/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reportRendererCrash = vi.fn(async () => 'Crash details copied. Paste into What happened?');

vi.mock('../lib/report-bug.js', () => ({
  reportRendererCrash: (...args: unknown[]) => reportRendererCrash(...args)
}));

import { ErrorBoundary } from './ErrorBoundary.js';

function Boom(): never {
  throw new Error('Minified React error #185');
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reportRendererCrash.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows reload and report actions after a render crash', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByRole('heading', { name: 'Renderer crashed' })).toBeTruthy();
    expect(screen.getByText('Minified React error #185')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload app' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Report a bug' })).toBeTruthy();
  });

  it('reports the caught message and stack through the bug helper', async () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Report a bug' }));
    await waitFor(() => expect(reportRendererCrash).toHaveBeenCalled());
    expect(reportRendererCrash.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      message: 'Minified React error #185'
    }));
    expect((await screen.findByRole('status')).textContent).toContain('Crash details copied');
  });
});
