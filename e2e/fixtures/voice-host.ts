// Bundled into the isolated Electron process by mobile-voice.spec.ts. Only OS
// credential storage and the external transcription service are fixtures; the
// credential selection, child capture and transcription code are production.
import { execFile } from 'node:child_process';
import { readCodexKeyring } from '../../apps/host-daemon/src/codex-auth-storage.js';
import { transcribeCodexVoice } from '../../apps/host-daemon/src/codex-voice-transcribe.js';
import { transcribeVoiceOnHost } from '../../apps/server/src/services/threads/voice-transcription.js';
import type { ProductHttpContext } from '../../apps/server/src/http/product-context.js';

export async function transcribe(args: {
  codexHome: string; node: string; keychainFixture: string;
  audioBase64: string; mimeType: string; filename: string;
}) {
  const run = ((file, commandArgs, options, callback) => {
    if (file !== '/usr/bin/security' || commandArgs[0] !== 'find-generic-password' || commandArgs[2] !== 'Codex Auth' || !/^cli\|[a-f0-9]{16}$/.test(commandArgs[4])) {
      throw new Error('Unexpected credential lookup');
    }
    return execFile(args.node, [args.keychainFixture, ...commandArgs], {
      ...options, env: { HOME: args.codexHome }
    }, callback);
  }) as typeof execFile;
  const ctx = {
    config: { getConfig: () => ({}) },
    hostHub: {
      resolveHostId: () => 'voice-fixture',
      callHostOnlineRpc: async ({ command }) => transcribeCodexVoice(command, {
        env: { CODEX_HOME: args.codexHome },
        readKeyring: (home) => readCodexKeyring(home, { platform: 'darwin', execFileImpl: run }),
        fetchImpl: async (url, init) => {
          const form = init!.body as FormData;
          const file = form.get('file') as File;
          if (url !== 'https://api.openai.com/v1/audio/transcriptions' ||
              new Headers(init!.headers).get('authorization') !== 'Bearer synthetic-e2e-key' ||
              form.get('model') !== 'gpt-4o-mini-transcribe' ||
              file.type !== args.mimeType || file.name !== args.filename ||
              await file.text() !== 'synthetic-microphone-audio') {
            throw new Error('Transcription request did not preserve the recording or auth');
          }
          return Response.json({ text: 'Voice works on my phone.' });
        }
      })
    }
  } as unknown as ProductHttpContext;
  try {
    const text = await transcribeVoiceOnHost(ctx, {
      bytes: Buffer.from(args.audioBase64, 'base64'), mimeType: args.mimeType, filename: args.filename
    });
    return { status: 200, body: { text } };
  } catch (error) {
    const failure = error as { status: number; code: string; message: string };
    return { status: failure.status ?? 500, body: { error: failure.code, message: failure.message } };
  }
}
