const MIN_OUTLINE_ITEMS = 3;

export function ThreadConversationToc({
  items,
  onJump
}: {
  items: Array<{ id: string; role: 'user' | 'assistant'; preview: string }>;
  onJump: (id: string) => void;
}) {
  if (items.length < MIN_OUTLINE_ITEMS) return null;
  return (
    <nav className="thread-toc" data-testid="thread-toc" aria-label="Conversation outline">
      <p className="thread-toc-heading">Outline</p>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`thread-toc-item is-${item.role}`}
          onClick={() => onJump(item.id)}
        >
          {item.preview || (item.role === 'user' ? 'User' : 'Assistant')}
        </button>
      ))}
    </nav>
  );
}
