import { useMemo } from 'react';
import { File, Folder, FolderGit2, MessageSquare, Puzzle, Terminal } from 'lucide-react';
import { suggestionKey, type TypeaheadSuggestion } from './types.js';

function directoryFromPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index > 0 ? path.slice(0, index) : '';
}

function sectionKind(item: TypeaheadSuggestion): 'threads' | 'projects' | 'files' | 'commands' | 'plugins' {
  if (item.kind === 'thread') return 'threads';
  if (item.kind === 'project') return 'projects';
  if (item.kind === 'command') return 'commands';
  if (item.kind === 'plugin') return 'plugins';
  return 'files';
}

function sectionLabel(kind: ReturnType<typeof sectionKind>): string {
  if (kind === 'threads') return 'Agents';
  if (kind === 'projects') return 'Projects';
  if (kind === 'commands') return 'Commands';
  if (kind === 'plugins') return 'Plugins';
  return 'Files';
}

function primaryLabel(item: TypeaheadSuggestion): string {
  if (item.kind === 'path') return item.name;
  if (item.kind === 'thread') return item.title;
  if (item.kind === 'project') return item.name;
  if (item.kind === 'plugin') return item.label;
  return item.name;
}

function trailingLabel(item: TypeaheadSuggestion): string {
  if (item.kind === 'path') return directoryFromPath(item.path);
  if (item.kind === 'thread') return item.projectName?.trim() || '';
  if (item.kind === 'command') return item.description;
  if (item.kind === 'plugin') return item.pluginId;
  return '';
}

function rowTitle(item: TypeaheadSuggestion): string {
  const primary = primaryLabel(item);
  const trailing = trailingLabel(item);
  if (item.kind === 'path') return item.path;
  if (trailing) return `${primary} · ${trailing}`;
  return primary;
}

function RowIcon({ item }: { item: TypeaheadSuggestion }) {
  if (item.kind === 'path' && item.entryKind === 'directory') {
    return <Folder className="composer-typeahead-icon" size={14} aria-hidden="true" />;
  }
  if (item.kind === 'path') return <File className="composer-typeahead-icon" size={14} aria-hidden="true" />;
  if (item.kind === 'thread') return <MessageSquare className="composer-typeahead-icon" size={14} aria-hidden="true" />;
  if (item.kind === 'project') return <FolderGit2 className="composer-typeahead-icon" size={14} aria-hidden="true" />;
  if (item.kind === 'plugin') return <Puzzle className="composer-typeahead-icon" size={14} aria-hidden="true" />;
  return <Terminal className="composer-typeahead-icon" size={14} aria-hidden="true" />;
}

export function ComposerTypeaheadMenu({
  suggestions,
  selectedIndex,
  triggerKind,
  onApply
}: {
  suggestions: readonly TypeaheadSuggestion[];
  selectedIndex: number;
  triggerKind: 'mention' | 'command';
  onApply: (item: TypeaheadSuggestion) => void;
}) {
  const sections = useMemo(() => {
    const grouped = new Map<ReturnType<typeof sectionKind>, TypeaheadSuggestion[]>();
    for (const item of suggestions) {
      const kind = sectionKind(item);
      const existing = grouped.get(kind);
      if (existing) existing.push(item);
      else grouped.set(kind, [item]);
    }
    return [...grouped.entries()].map(([kind, items]) => ({ kind, items }));
  }, [suggestions]);

  let offset = 0;

  return (
    <div
      className="mention-popover composer-typeahead-menu"
      role="listbox"
      data-testid="composer-typeahead-menu"
      aria-label={triggerKind === 'command' ? 'Commands' : 'Mentions'}
    >
      {sections.length === 0 ? (
        <div className="composer-typeahead-empty">
          {triggerKind === 'command' ? 'No matching commands' : 'No matching mentions'}
        </div>
      ) : sections.map((section) => {
        const start = offset;
        offset += section.items.length;
        return (
          <div key={section.kind} className="composer-typeahead-section">
            <div className="composer-typeahead-heading">{sectionLabel(section.kind)}</div>
            {section.items.map((item, localIndex) => {
              const index = start + localIndex;
              const selected = index === selectedIndex;
              const trailing = trailingLabel(item);
              return (
                <button
                  key={suggestionKey(item)}
                  type="button"
                  role="option"
                  data-testid="composer-typeahead-item"
                  data-kind={item.kind}
                  aria-selected={selected}
                  className={`mention-item composer-typeahead-item${selected ? ' active' : ''}`}
                  title={rowTitle(item)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onApply(item);
                  }}
                >
                  <RowIcon item={item} />
                  <span className="composer-typeahead-primary">{primaryLabel(item)}</span>
                  {trailing ? (
                    <span className="composer-typeahead-trailing">{trailing}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
