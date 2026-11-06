import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { definePluginApp, useRealtime, useRpc } from '@zana-ai/zcc-plugin-sdk/app';
import { MAX_CLIP_BYTES, openPeonSelection, type Clip, type Cue, type Preferences, type SoundState } from './model.js';
import { mountBackground, runtimeStatus } from './runtime.js';
import { SoundPlayer } from './player.js';
import { styles } from './styles.js';

export async function readClip(file: File): Promise<Clip> {
  if (file.size > MAX_CLIP_BYTES) throw new Error(`${file.name} exceeds 1 MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return { name: file.name, mime: 'audio/wav', base64: btoa(binary) };
}

export function SoundStudio() {
  const rpc = useRpc(), [state, setState] = useState<SoundState | null>(null), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [name, setName] = useState('My sound pack'), [needsFile, setNeedsFile] = useState<File>(), [idleFile, setIdleFile] = useState<File>();
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);
  const savingVolume = useRef(false);
  const player = useRef<SoundPlayer | null>(null), revision = useRef(0), alive = useRef(true);
  const runtime = useSyncExternalStore(runtimeStatus.subscribe, runtimeStatus.get);
  const folder = useRef<HTMLInputElement>(null);
  const load = () => {
    const request = ++revision.current;
    void rpc.call('read').then(value => { if (alive.current && request === revision.current) setState(value as SoundState); }).catch(error => { if (alive.current) setMessage(String(error)); });
  };
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; player.current?.stop(); }; }, [rpc]);
  useRealtime('changed', load);
  async function action(method: string, args: unknown, success: string) {
    setBusy(true); setMessage('');
    try { const value = await rpc.call(method, args); if (alive.current) { ++revision.current; setState(value as SoundState); setMessage(success); } return true; }
    catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : String(error)); return false; }
    finally { if (alive.current) setBusy(false); }
  }
  const configure = async (patch: Partial<Preferences>) => {
    const before = state;
    setState(current => current ? { ...current, preferences: { ...current.preferences, ...patch } } : current);
    if (!await action('configure', patch, 'Settings saved.') && alive.current) setState(before);
  };
  async function saveVolume(value: number) {
    if (savingVolume.current || value === state?.preferences.volume) return;
    savingVolume.current = true;
    try { await configure({ volume: value }); } finally { savingVolume.current = false; setVolumeDraft(null); }
  }
  async function preview(cue: Cue) {
    if (!state) return;
    const pack = state.packs.find(p => p.id === state.preferences.packId), clip = cue === 'idle' ? pack?.idle : pack?.needsYou;
    if (pack && !clip) { setMessage('This pack has no sound for that event.'); return; }
    try {
      player.current ??= new SoundPlayer();
      await player.current.play(cue, state.preferences.volume, clip);
      setMessage(state.preferences.volume === 0 ? 'Volume is muted.' : `${cue === 'idle' ? 'Idle' : 'Needs you'} preview played.`);
    } catch (error) { setMessage(`Could not play this audio: ${error instanceof Error ? error.message : String(error)}`); }
  }
  async function importFiles() {
    setBusy(true);
    try { await action('importPack', { name, ...(needsFile ? { needsYou: await readClip(needsFile) } : {}), ...(idleFile ? { idle: await readClip(idleFile) } : {}) }, 'Sound pack imported.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  async function importFolder(files: File[]) {
    setBusy(true);
    try {
      const manifest = files.find(file => file.name === 'openpeon.json');
      if (!manifest || manifest.size > 64 * 1024) throw new Error('Choose a folder containing openpeon.json (up to 64 KB).');
      const selection = openPeonSelection(JSON.parse(await manifest.text()));
      const root = manifest.webkitRelativePath.slice(0, -manifest.name.length);
      const find = async (path?: string) => {
        if (!path) return undefined;
        const file = files.find(file => file.webkitRelativePath === root + path);
        if (!file) throw new Error(`The pack is missing ${path}.`);
        return readClip(file);
      };
      await action('importPack', { name: selection.name, needsYou: await find(selection.needsYou), idle: await find(selection.idle) }, 'OpenPeon pack imported.');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  if (!state) return <section className="sound-studio"><style>{styles}</style><div className="sound-inner"><h2>Sound Studio</h2><p role="status">{message || 'Loading sounds…'}</p></div></section>;
  const p = state.preferences, pack = state.packs.find(pack => pack.id === p.packId);
  return <section className="sound-studio" aria-label="Sound Studio"><style>{styles}</style><div className="sound-inner">
    <header><span className="sound-eyebrow">PLUGIN · NOTIFICATIONS</span><h2>Give your agents a voice.</h2><p>Your sounds, your rules. A little personality without a room full of interruptions.</p></header>
    <div className="sound-card sound-master"><div><h3>Sound notifications</h3><p>{p.enabled ? 'On for the events you choose below.' : 'Off. Preview sounds before switching on.'}</p></div><button type="button" role="switch" aria-checked={p.enabled} disabled={busy} aria-label="Sound notifications" onClick={() => void configure({ enabled: !p.enabled })}>{p.enabled ? 'On' : 'Off'}</button></div>
    <div className="sound-card"><h3>Sound packs</h3><p>Start with chimes or bring your own collection.</p><div className="sound-packs" role="group" aria-label="Sound packs">
      {[{ id: 'chimes', name: 'Soft chimes' }, ...state.packs].map(item => <button type="button" key={item.id} disabled={busy} aria-pressed={p.packId === item.id} onClick={() => void configure({ packId: item.id })}><strong>{item.name}</strong><span>{item.id === 'chimes' ? 'Built in to this plugin' : 'Your audio'}</span></button>)}
    </div><div className="sound-actions"><button type="button" onClick={() => void preview('needs-you')}>Preview Needs you</button><button type="button" onClick={() => void preview('idle')}>Preview Idle</button>{pack && <button type="button" disabled={busy} onClick={() => void action('remove', pack.id, 'Pack removed. Switched to soft chimes.')}>Remove {pack.name}</button>}</div></div>
    <div className="sound-card"><h3>When to speak</h3>
      <label className="sound-row"><span><strong>Needs you</strong><small>An agent asks for input or approval.</small></span><input type="checkbox" checked={p.needsYou} disabled={busy} onChange={event => void configure({ needsYou: event.target.checked })}/></label>
      <label className="sound-row"><span><strong>Becomes idle</strong><small>After 5 seconds at rest. Idle is not a success signal.</small></span><input type="checkbox" checked={p.idle} disabled={busy} onChange={event => void configure({ idle: event.target.checked })}/></label>
      <div className="sound-row"><span><strong>Space out idle alerts</strong><small>Across all agents. Requests for input take priority.</small></span><div className="sound-segments" role="group" aria-label="Idle alert spacing">{[5, 10, 15, 30, 60].map(seconds => <button type="button" key={seconds} aria-pressed={p.idleSpacingSeconds === seconds} disabled={busy} onClick={() => void configure({ idleSpacingSeconds: seconds })}>{seconds}s</button>)}</div></div>
      <label className="sound-row"><span><strong>Volume · {volumeDraft ?? p.volume}%</strong></span><input type="range" aria-label="Sound volume" min="0" max="100" value={volumeDraft ?? p.volume} disabled={busy} onChange={event => setVolumeDraft(Number(event.target.value))} onPointerUp={event => void saveVolume(Number(event.currentTarget.value))} onKeyUp={event => void saveVolume(Number(event.currentTarget.value))} onBlur={event => void saveVolume(Number(event.currentTarget.value))}/></label>
    </div>
    <div className="sound-card"><h3>Bring your own sounds</h3><p>WAV, MP3, or OGG · Up to 1 MB per file · Playback capped at 8 seconds.</p>
      <label className="sound-field">Pack name<input value={name} maxLength={80} onChange={event => setName(event.target.value)}/></label>
      <div className="sound-files"><label className="sound-field">Needs you audio<input type="file" accept=".wav,.mp3,.ogg" onChange={event => setNeedsFile(event.target.files?.[0])}/></label><label className="sound-field">Idle audio<input type="file" accept=".wav,.mp3,.ogg" onChange={event => setIdleFile(event.target.files?.[0])}/></label></div>
      <div className="sound-actions"><button type="button" disabled={busy || (!needsFile && !idleFile)} onClick={() => void importFiles()}>Save sound pack</button><button type="button" disabled={busy} onClick={() => folder.current?.click()}>Import OpenPeon folder…</button></div>
      <input ref={folder} type="file" multiple hidden {...{ webkitdirectory: '' }} onChange={event => { void importFolder(Array.from(event.target.files ?? [])); event.target.value = ''; }}/>
      <p className="sound-footnote">OpenPeon import uses the first input.required and task.complete clips. Completion audio is mapped to the idle event. Missing event sounds stay silent.</p>
    </div>
    <p role="status" className="sound-message">{message}</p><footer><span>{runtime}</span><span>Want different rules? Fork this plugin and edit policy.ts.</span></footer>
  </div></section>;
}

export default definePluginApp(app => {
  app.slots.navPanel({ id: 'main', title: 'Sound Studio', icon: 'Volume2', placement: 'extensions', component: SoundStudio });
  app.contentScripts.register({ id: 'notifications', mount: mountBackground });
});
