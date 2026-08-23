import { describe, expect, it } from 'vitest';
import { browserRequestProblem } from './browser-request-guard.js';

function context(input: { url?: string; method?: string; origin?: string; host?: string; contentType?: string }) {
  const headers: Record<string, string | undefined> = {
    host: input.host ?? '127.0.0.1:8780',
    origin: input.origin,
    'content-type': input.contentType
  };
  return {
    req: {
      url: input.url ?? 'http://127.0.0.1:8780/api/v1/health',
      method: input.method ?? 'GET',
      header: (name: string) => headers[name.toLowerCase()]
    }
  };
}

const deps = { config: { serverPort: 8780, devAppPort: 5173 } };

describe('browserRequestProblem', () => {
  it('allows a caller with no Origin (CLI)', () => {
    expect(browserRequestProblem(context({}), deps)).toBeNull();
  });

  it('allows the local Vite origin', () => {
    expect(
      browserRequestProblem(context({ origin: 'http://localhost:5173' }), deps)
    ).toBeNull();
    expect(
      browserRequestProblem(context({ origin: 'http://127.0.0.1:5173' }), deps)
    ).toBeNull();
  });

  it('allows the loopback server origin', () => {
    expect(
      browserRequestProblem(context({ origin: 'http://127.0.0.1:8780' }), deps)
    ).toBeNull();
  });

  it('denies a foreign Origin', () => {
    const problem = browserRequestProblem(context({ origin: 'https://evil.example' }), deps);
    expect(problem?.status).toBe(403);
    expect(problem?.error).toMatch(/not a local app origin/);
  });

  it('denies a non-loopback Host', () => {
    const problem = browserRequestProblem(context({ host: 'example.com' }), deps);
    expect(problem?.status).toBe(403);
  });

  it('requires JSON for mutations', () => {
    const problem = browserRequestProblem(
      context({ method: 'PATCH', contentType: 'text/plain' }),
      deps,
      { requireJsonForMutation: true }
    );
    expect(problem?.status).toBe(415);
  });

  it('allows multipart when JSON is not required', () => {
    expect(browserRequestProblem(
      context({
        method: 'POST',
        url: 'http://127.0.0.1:8780/api/v1/system/voice-transcription',
        contentType: 'multipart/form-data; boundary=abc',
        origin: 'http://127.0.0.1:5173'
      }),
      deps,
      { requireJsonForMutation: false }
    )).toBeNull();
  });
});
