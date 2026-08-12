import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes
} from 'react';

export interface AutoGrowTextareaHandle {
  focus: () => void;
  element: () => HTMLTextAreaElement | null;
}

const MAX_COMPOSER_INPUT_HEIGHT = 132;

/**
 * A renderer-local command surface derived from the former Chat composer.
 * It owns only visual/input mechanics; features retain their own launch, chat,
 * attachment, and data authorization logic.
 */
export function CommandComposer({
  children,
  className = '',
  labelledBy,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <div
      {...props}
      className={`ui-command-composer ${className}`}
      role="group"
      aria-labelledby={labelledBy}
    >
      {children}
    </div>
  );
}

export const AutoGrowTextarea = forwardRef<AutoGrowTextareaHandle, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function AutoGrowTextarea({ className = '', onKeyDown, value, ...props }, ref) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
      element: () => textareaRef.current
    }), []);

    useEffect(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      // Reset before measuring so deleting lines shrinks the control too. The
      // cap keeps a long draft from turning a compact command bar into a page.
      textarea.style.height = '0px';
      const next = Math.min(Math.max(textarea.scrollHeight, 76), MAX_COMPOSER_INPUT_HEIGHT);
      textarea.style.height = `${next}px`;
      textarea.style.overflowY = textarea.scrollHeight > MAX_COMPOSER_INPUT_HEIGHT ? 'auto' : 'hidden';
    }, [value]);

    return (
      <textarea
        {...props}
        ref={textareaRef}
        value={value}
        rows={1}
        className={`ui-command-composer-input ${className}`}
        onKeyDown={onKeyDown}
      />
    );
  }
);

export function ComposerToolbar({ children }: { children: ReactNode }) {
  return <div className="ui-command-composer-toolbar">{children}</div>;
}

export function ComposerIconButton({
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} type={props.type ?? 'button'} className={`ui-command-icon-button ${className}`}>
      {children}
    </button>
  );
}
