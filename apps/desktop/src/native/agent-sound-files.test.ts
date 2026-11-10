import { mkdtemp, writeFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { AgentSoundFiles, isAgentSoundKind, MAX_SOUND_FILE_BYTES } from './agent-sound-files.js';
let root: string, files: AgentSoundFiles;
const wav = Buffer.from('RIFF1234WAVEbytes');
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'sound-files-')); files = new AgentSoundFiles(join(root, 'stored')); await files.ready; });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function audio(name = 'chime.wav', bytes = wav) { const path = join(root, name); await writeFile(path, bytes); return path; }
it('copies audio, stores only one record per event, and reloads independent selections', async () => {
  const source = await audio(); await files.import('done', source);
  await files.import('needs-you', await audio('question.mp3', Buffer.from('ID3audio')));
  await files.import('idle', await audio('idle.ogg', Buffer.from('OggSaudio')));
  await rm(source); // Playback is independent of the original file.
  const restored = new AgentSoundFiles(join(root, 'stored')); await restored.ready;
  expect(restored.selections()).toEqual({ done: { name: 'chime.wav' }, 'needs-you': { name: 'question.mp3' }, idle: { name: 'idle.ogg' } });
  expect(restored.current('done')).toEqual({ mime: 'audio/wav', base64: wav.toString('base64') });
  expect((await stat(join(root, 'stored', 'done.json'))).mode & 0o777).toBe(0o600);
  expect(await readdir(join(root, 'stored'))).toHaveLength(3);
  await restored.clear('done'); await restored.clear('done');
  expect(restored.current('done')).toBeUndefined(); expect(restored.selections()).not.toHaveProperty('done');
});
it('recognizes MPEG frame headers and ignores misleading file extensions', async () => {
  await files.import('done', await audio('sound.txt', Buffer.from([0xff, 0xfb, 0, 0])));
  expect(files.current('done')?.mime).toBe('audio/mpeg');
});
it('rejects empty, oversized, non-audio, directories and unknown event names without losing a saved sound', async () => {
  await files.import('done', await audio());
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(MAX_SOUND_FILE_BYTES + 1), Buffer.from('not audio')]) {
    await expect(files.import('done', await audio('bad.mp3', bytes))).rejects.toThrow(/Choose/);
  }
  await expect(files.import('done', root)).rejects.toThrow(/Choose/);
  expect(() => files.import('../escape' as never, root)).toThrow('Unknown agent sound');
  expect(() => files.clear('../escape' as never)).toThrow('Unknown agent sound');
  expect(files.selections()).toEqual({ done: { name: 'chime.wav' } });
  expect(isAgentSoundKind('done')).toBe(true); expect(isAgentSoundKind(null)).toBe(false);
});
it('serializes imports and clears so the final action wins without temporary-file leaks', async () => {
  const source = await audio();
  await Promise.all([files.import('done', source), files.clear('done'), files.import('done', source)]);
  expect(files.selections()).toEqual({ done: { name: 'chime.wav' } });
  expect(await readdir(join(root, 'stored'))).toEqual(['done.json']);
  expect(JSON.parse(await readFile(join(root, 'stored', 'done.json'), 'utf8')).clip.base64).toBe(wav.toString('base64'));
});
it('contains damaged or oversized records and sanitizes display names', async () => {
  await mkdir(join(root, 'stored'));
  await writeFile(join(root, 'stored', 'done.json'), '{');
  await writeFile(join(root, 'stored', 'idle.json'), JSON.stringify({ name: 'bad', clip: { base64: '!' } }));
  await writeFile(join(root, 'stored', 'needs-you.json'), Buffer.alloc(2 * MAX_SOUND_FILE_BYTES));
  const restored = new AgentSoundFiles(join(root, 'stored')); await restored.ready;
  expect(restored.selections()).toEqual({});
  await restored.import('done', await audio('beep\n.wav'));
  expect(restored.selections().done?.name).toBe('beep.wav');
  await writeFile(join(root, 'stored', 'done.json'), JSON.stringify({ name: 'bad', clip: { base64: Buffer.from('wrong').toString('base64') } }));
  const damaged = new AgentSoundFiles(join(root, 'stored')); await damaged.ready;
  expect(damaged.selections()).toEqual({});
});
it('does not change memory on failed writes or deletes and recovers after errors', async () => {
  const blocked = join(root, 'blocked'); await writeFile(blocked, 'not a directory');
  const broken = new AgentSoundFiles(blocked); await broken.ready;
  await expect(broken.import('done', await audio())).rejects.toThrow(); expect(broken.selections()).toEqual({});
  await files.import('done', await audio());
  await rm(join(root, 'stored', 'done.json')); await mkdir(join(root, 'stored', 'done.json'));
  await expect(files.clear('done')).rejects.toThrow(); expect(files.selections()).toHaveProperty('done');
  await rm(join(root, 'stored', 'done.json'), { recursive: true }); await files.clear('done');
  expect(files.selections()).toEqual({});
});
