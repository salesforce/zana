import { useState } from 'react';
import type { PluginHomepageSectionRegistration } from '@zana-ai/zcc-plugin-sdk/app';
import { Modal } from '@/components/Modal';
import { builtInWidgets, displays, draftFromDescription, emptyDraft, type Display, type HomeWidget, type Source, type WidgetDraft } from './model.js';
import { pluginSource, WidgetContent } from './WidgetContent.js';

export function WidgetDialog({ plugins, existing, onClose, onSave, onRemove }: {
  plugins: readonly PluginHomepageSectionRegistration[];
  existing: HomeWidget | null;
  onClose: () => void;
  onSave: (draft: WidgetDraft) => void;
  onRemove: () => void;
}) {
  const [tab, setTab] = useState<'browse' | 'build'>(existing ? 'build' : 'browse');
  const [search, setSearch] = useState('');
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState<WidgetDraft | null>(existing);
  const [describe, setDescribe] = useState(!existing);
  const pluginDrafts = plugins.map(plugin => ({
    title: plugin.title, source: pluginSource(plugin), display: 'list', content: ''
  } satisfies WidgetDraft));
  const catalogue = [...builtInWidgets, ...pluginDrafts];
  const sourceOptions: [Source, string][] = [
    ['personal', 'Personal content'], ['inbox', 'Inbox'], ['threads', 'Recent threads'],
    ...pluginDrafts.map((entry): [Source, string] => [entry.source, entry.title])
  ];
  if (draft && !sourceOptions.some(([source]) => source === draft.source)) sourceOptions.push([draft.source, 'Unavailable plugin']);
  const results = catalogue.filter(entry => entry.title.toLowerCase().includes(search.trim().toLowerCase()));
  const plugin = plugins.find(section => pluginSource(section) === draft?.source);
  const formats: Display[] = draft?.source === 'personal' ? ['text', 'list', 'count', 'chart', 'checklist'] : ['list', 'count'];

  function build(template: WidgetDraft) {
    setDraft(template);
    setTab('build');
    setDescribe(false);
  }

  return <Modal title={existing ? 'Edit widget' : 'Add widget'} onClose={onClose} className="home-widget-dialog"
    footer={draft && tab === 'build' && <div className="home-widget-dialog-actions">
      {existing && <button className="home-widget-btn" onClick={onRemove}>Remove widget</button>}
      <button className="home-widget-btn is-primary" disabled={!draft.title.trim()}
        onClick={() => onSave({ ...draft, title: draft.title.trim() })}>{existing ? 'Save changes' : 'Pin to Home'}</button>
    </div>}>
    {!existing && <div className="home-widget-tabs" aria-label="Creation method">
      <button type="button" className="home-widget-btn" aria-pressed={tab === 'browse'} onClick={() => setTab('browse')}>Browse</button>
      <button type="button" className="home-widget-btn" aria-pressed={tab === 'build'} onClick={() => setTab('build')}>Build</button>
    </div>}
    {tab === 'browse' && <>
      <label className="home-widget-field">Find a widget<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <div className="home-widget-catalogue">
        {results.map(entry => <button key={`${entry.source}:${entry.title}`} type="button" className="home-widget-btn"
          onClick={() => build(entry)}>{entry.title}</button>)}
        {!results.length && <p className="home-widget-message">No widgets match your search.</p>}
      </div>
    </>}
    {tab === 'build' && <>
      {!existing && (describe ? <form onSubmit={event => {
        event.preventDefault();
        if (prompt.trim()) build(draftFromDescription(prompt, catalogue));
      }}>
        <label className="home-widget-field">What should this widget show?
          <textarea rows={2} maxLength={500} value={prompt} placeholder="Make a checklist called Launch with: Review, Publish"
            onChange={event => setPrompt(event.target.value)} />
        </label>
        <div className="home-widget-dialog-actions">
          <button type="button" className="home-widget-btn" onClick={() => build(emptyDraft)}>Start from scratch</button>
          <button type="submit" className="home-widget-btn is-primary" disabled={!prompt.trim()}>Generate preview</button>
        </div>
      </form> : <button type="button" className="home-widget-btn" onClick={() => setDescribe(true)}>{prompt ? 'Revise request' : 'Describe this widget'}</button>)}
      {draft && <>
        <label className="home-widget-field">Widget name<input maxLength={80} value={draft.title}
          onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
        <div className="home-widget-fields">
          <label className="home-widget-field">Source
            <select value={draft.source} onChange={event => {
              const source = event.target.value as Source;
              setDraft({ ...draft, source, display: source === 'personal' ? 'text' : 'list' });
            }}>
              {sourceOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          {!draft.source.startsWith('plugin:') && <label className="home-widget-field">Display
            <select value={draft.display} onChange={event => setDraft({ ...draft, display: event.target.value as Display })}>
              {formats.map(format => <option key={format} value={format}>{displays[format]}</option>)}
            </select>
          </label>}
        </div>
        {draft.source === 'personal' && <label className="home-widget-field">Content
          <textarea rows={3} maxLength={4000} value={draft.content}
            placeholder={draft.display === 'chart' ? 'One label and value per line, for example Proposal: 120' : 'Enter text or one item per line'}
            onChange={event => setDraft({ ...draft, content: event.target.value })} />
        </label>}
        <section className="home-widget-preview" aria-label="Widget preview">
          <strong>{draft.title.trim() || 'Widget preview'}</strong>
          <WidgetContent widget={draft} plugin={plugin} preview />
        </section>
      </>}
    </>}
  </Modal>;
}
