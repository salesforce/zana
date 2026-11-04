import { describe, expect, it } from 'vitest';
import { NOTE_DETAIL_MAX, NOTE_LABEL_MAX, NOTES_PER_PLUGIN_MAX, NOTES_TOTAL_MAX, PluginLinkNotes, parsePluginLinkNote } from './plugin-link-notes.js';

const note = { state: 'attention', label: 'Sync not set up' } as const;

describe('parsePluginLinkNote', () => {
  it('accepts and trims a valid note', () => {
    expect(parsePluginLinkNote({ state: 'ok', label: '  Synced ' })).toEqual({ state: 'ok', label: 'Synced' });
    expect(parsePluginLinkNote({ state: 'attention', label: 'x', detail: ' why ' })).toEqual({ state: 'attention', label: 'x', detail: 'why' });
    expect(parsePluginLinkNote({ state: 'ok', label: 'x', detail: '   ' })).toEqual({ state: 'ok', label: 'x' });
  });

  it.each([
    ['null', null], ['array', []], ['string', 'x'], ['bad state', { state: 'bad', label: 'x' }], ['missing label', { state: 'ok' }],
    ['empty label', { state: 'ok', label: ' ' }], ['non-string label', { state: 'ok', label: 3 }],
    ['long label', { state: 'ok', label: 'x'.repeat(NOTE_LABEL_MAX + 1) }], ['control in label', { state: 'ok', label: 'a\nb' }],
    ['long detail', { state: 'ok', label: 'x', detail: 'y'.repeat(NOTE_DETAIL_MAX + 1) }], ['non-string detail', { state: 'ok', label: 'x', detail: 1 }],
    ['control in detail', { state: 'ok', label: 'x', detail: 'a\u0000b' }], ['extra key', { state: 'ok', label: 'x', html: '<b>' }]
  ])('rejects %s', (_name, value) => {
    expect(parsePluginLinkNote(value)).toBeNull();
  });

  it('keeps the boundary lengths', () => {
    expect(parsePluginLinkNote({ state: 'ok', label: 'x'.repeat(NOTE_LABEL_MAX), detail: 'y'.repeat(NOTE_DETAIL_MAX) })).not.toBeNull();
  });
});

describe('PluginLinkNotes', () => {
  it('stores copies and replaces an existing entry', () => {
    const notes = new PluginLinkNotes();
    expect(notes.set('p', 'peer', 's', { ...note })).toBe(true);
    const read = notes.get('p', 'peer', 's')!;
    read.label = 'mutated';
    expect(notes.get('p', 'peer', 's')).toEqual(note);
    expect(notes.set('p', 'peer', 's', { state: 'ok', label: 'Done' })).toBe(true);
    expect(notes.size).toBe(1);
    expect(notes.get('p', 'peer', 's')).toEqual({ state: 'ok', label: 'Done' });
    expect(notes.get('p', 'peer', 'other')).toBeUndefined();
  });

  it('refuses new entries past the per-plugin and total caps but still allows replacement', () => {
    const notes = new PluginLinkNotes();
    for (let i = 0; i < NOTES_PER_PLUGIN_MAX; i++) expect(notes.set('p', `peer${i}`, 's', note)).toBe(true);
    expect(notes.set('p', 'extra', 's', note)).toBe(false);
    expect(notes.set('p', 'peer0', 's', { state: 'ok', label: 'again' })).toBe(true);
    expect(notes.set('q', 'peer0', 's', note)).toBe(true);
    const total = new PluginLinkNotes();
    for (let i = 0; i < NOTES_TOTAL_MAX; i++) expect(total.set(`plugin${Math.floor(i / 8)}`, `peer${i}`, 's', note)).toBe(true);
    expect(total.set('another', 'peer', 's', note)).toBe(false);
  });

  it('clears one entry, a use, a peer and a plugin independently', () => {
    const notes = new PluginLinkNotes();
    for (const [p, peer, scope] of [['a', 'x', '1'], ['a', 'x', '2'], ['a', 'y', '1'], ['b', 'x', '1']] as const) notes.set(p, peer, scope, note);
    notes.clear('a', 'x', '1');
    expect(notes.size).toBe(3);
    notes.clearUse('a', 'x', '2');
    expect(notes.get('a', 'x', '2')).toBeUndefined();
    expect(notes.get('b', 'x', '1')).toBeDefined();
    notes.set('a', 'x', '9', note);
    notes.clearUse('a', 'x');
    expect(notes.get('a', 'x', '9')).toBeUndefined();
    expect(notes.get('a', 'y', '1')).toBeDefined();
    notes.clearPeer('x');
    expect(notes.get('b', 'x', '1')).toBeUndefined();
    notes.clearPlugin('a');
    expect(notes.size).toBe(0);
  });

  it('retainOnly keeps just the live uses', () => {
    const notes = new PluginLinkNotes();
    notes.set('a', 'x', '1', note); notes.set('a', 'x', '2', note);
    notes.retainOnly(new Set([PluginLinkNotes.liveKey('a', 'x', '2')]));
    expect(notes.get('a', 'x', '1')).toBeUndefined();
    expect(notes.get('a', 'x', '2')).toBeDefined();
  });
});
