import { Link } from 'react-router-dom';
import type { PluginHomepageSectionRegistration } from '@zana-ai/zcc-plugin-sdk/app';
import { PluginSlotBoundary } from '@/plugins/PluginSlotBoundary';
import { useInbox, useInboxRead } from '@/store';
import { useThreads } from '@/thread-store';
import { focusInboxEntry } from '@/lib/inboxNavigation';
import { chartValues, type Source, type WidgetDraft } from './model.js';

export function pluginSource(section: PluginHomepageSectionRegistration): Source {
  return `plugin:${section.pluginId}:${section.id}`;
}

export function WidgetContent({ widget, plugin, preview, onContent }: {
  widget: WidgetDraft;
  plugin?: PluginHomepageSectionRegistration;
  preview?: boolean;
  onContent?: (content: string) => void;
}) {
  if (widget.source === 'inbox') return <InboxRows count={widget.display === 'count'} preview={preview} />;
  if (widget.source === 'threads') return <ThreadRows count={widget.display === 'count'} preview={preview} />;
  if (widget.source === 'personal') return <PersonalWidget widget={widget} onContent={onContent} />;
  if (!plugin) return <p className="home-widget-message">This widget’s plugin is unavailable.</p>;
  if (preview) return <p className="home-widget-message">Pin this widget to see live content from {plugin.title}.</p>;
  const Section = plugin.component;
  return (
    <PluginSlotBoundary pluginId={plugin.pluginId} generation={plugin.generation}>
      <Section pluginId={plugin.pluginId} projectId={null} />
    </PluginSlotBoundary>
  );
}

function InboxRows({ count, preview }: { count: boolean; preview?: boolean }) {
  const entries = useInbox(state => state.entries);
  const read = useInboxRead(state => state.readIds);
  const pending = entries.filter(entry => !Object.hasOwn(read, entry.id));
  if (count) return <strong className="home-widget-number">{pending.length}</strong>;
  if (!pending.length) return <p className="home-widget-message">You’re caught up.</p>;
  return <ul className="home-widget-rows">
    {pending.slice(0, 12).map(entry => <li key={entry.id}>
      <button type="button" disabled={preview} onClick={() => focusInboxEntry(entry)}>
        {entry.subject || entry.origin?.title || entry.comments?.slice(0, 100) || 'Inbox update'}
      </button>
    </li>)}
  </ul>;
}

function ThreadRows({ count, preview }: { count: boolean; preview?: boolean }) {
  const threads = useThreads(state => state.threads);
  const visible = threads.filter(thread => thread.visibility !== 'hidden' && !thread.archivedAt);
  if (count) return <strong className="home-widget-number">{visible.length}</strong>;
  const recent = visible.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)).slice(0, 12);
  if (!recent.length) return <p className="home-widget-message">Your recent threads will appear here.</p>;
  return <ul className="home-widget-rows">
    {recent.map(thread => <li key={thread.id}>{preview
      ? <span>{thread.title || 'Untitled thread'}</span>
      : <Link to={`/threads/${encodeURIComponent(thread.id)}`}>{thread.title || 'Untitled thread'}</Link>}</li>)}
  </ul>;
}

function PersonalWidget({ widget, onContent }: { widget: WidgetDraft; onContent?: (content: string) => void }) {
  const lines = widget.content.split('\n').filter(line => line.trim());
  if (widget.display === 'count') return <strong className="home-widget-number">{lines.length}</strong>;
  if (!lines.length) return <p className="home-widget-message">Add content to this widget.</p>;
  if (widget.display === 'text') return <p className="home-widget-text">{widget.content}</p>;
  if (widget.display === 'chart') {
    const points = chartValues(widget.content);
    const max = Math.max(1, ...points.map(point => point.value));
    if (!points.length) return <p className="home-widget-message">Enter a label and value on each line.</p>;
    return <ul className="home-widget-chart">
      {points.map((point, index) => <li key={index}>
        <span>{point.name}</span>
        <span className="home-widget-bar" aria-hidden="true"><span style={{ width: `${point.value / max * 100}%` }} /></span>
        <span>{point.value.toLocaleString()}</span>
      </li>)}
    </ul>;
  }
  if (widget.display === 'checklist') return <ul className="home-widget-rows">
    {lines.map((line, index) => {
      const checked = /^\[x\]\s/i.test(line);
      const text = line.replace(/^\[[ x]\]\s/i, '');
      return <li key={index}><label><input type="checkbox" checked={checked} disabled={!onContent}
        onChange={() => onContent?.(lines.map((value, i) => i === index ? `${checked ? '[ ]' : '[x]'} ${text}` : value).join('\n'))} /> {text}</label></li>;
    })}
  </ul>;
  return <ul className="home-widget-rows">{lines.map((line, index) => <li key={index}>{line}</li>)}</ul>;
}
