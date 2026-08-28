import { useRef, type FormEvent, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';

export function threadDetailSearchClassName(draft: string): string {
  return draft.trim().length > 0 ? 'thread-detail-search has-query' : 'thread-detail-search';
}

export function ThreadDetailSearch({
  value,
  onChange,
  onSubmit
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (needle: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(value.trim());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return;
    onChange('');
    onSubmit('');
    event.currentTarget.blur();
  };

  return (
    <form
      className={threadDetailSearchClassName(value)}
      data-testid="thread-detail-search"
      onSubmit={submit}
    >
      <button
        type="button"
        className="icon-btn thread-detail-search-toggle"
        aria-label="Search in thread"
        onClick={() => inputRef.current?.focus()}
      >
        <Search size={14} />
      </button>
      <input
        ref={inputRef}
        type="search"
        value={value}
        aria-label="Search in thread"
        placeholder="Search"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </form>
  );
}
