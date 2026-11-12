import {
  createContext,
  useContext,
  useEffect,
  type ComponentProps
} from 'react';
import { Modal } from '../Modal.js';

export const SetupPageContext = createContext<{
  active: boolean;
  setBusy(busy: boolean): void;
} | null>(null);
export function useSetupBusy(busy: boolean) {
  const page = useContext(SetupPageContext);
  const setBusy = page?.setBusy;
  useEffect(() => {
    setBusy?.(busy);
  }, [busy, setBusy]);
}
export function useSetupPage() {
  return useContext(SetupPageContext);
}

/** The same form can run in a legacy dialog or an ordinary, non-blocking page. */
export function SetupFrame(props: ComponentProps<typeof Modal>) {
  const page = useSetupPage();
  if (!page) return <Modal {...props} />;
  return (
    <section
      className={`setup-form ${props.className ?? ''}`}
      aria-label={props.title}
    >
      <header className="setup-form-heading">
        <h1>{props.title}</h1>
      </header>
      <div className={`modal-body ${props.bodyClassName ?? ''}`}>
        {props.children}
      </div>
      {props.footer !== undefined && (
        <footer className="modal-footer">{props.footer}</footer>
      )}
    </section>
  );
}
