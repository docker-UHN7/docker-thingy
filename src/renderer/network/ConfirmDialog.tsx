import { useCallback, useEffect, useRef, useState } from "react";

type ConfirmTone = "default" | "danger";

type ConfirmState = {
  message: string;
  tone: ConfirmTone;
};

// Native window.confirm() renders as an unstyled OS dialog that looks
// nothing like the rest of the app (and is unreadable in dark mode on some
// platforms). This swaps it for an in-app modal with the same call-site
// ergonomics: `await confirm(message)` resolves to true/false exactly like
// window.confirm() did, so the calling handlers barely change.
export function useConfirmDialog() {
  const [state, setState] = useState<ConfirmState | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const respond = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setState(null);
  }, []);

  const confirm = useCallback((message: string, tone: ConfirmTone = "default") => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setState({ message, tone });
    });
  }, []);

  useEffect(() => {
    if (!state) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        respond(false);
      } else if (event.key === "Enter") {
        respond(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state, respond]);

  const dialog = state ? (
    <div className="modal-backdrop" onClick={() => respond(false)}>
      <div className="confirm-dialog" role="alertdialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <p className="confirm-dialog__message">{state.message}</p>
        <div className="confirm-dialog__actions">
          <button className="button button--secondary" onClick={() => respond(false)}>
            Cancel
          </button>
          <button
            className={`button ${state.tone === "danger" ? "button--danger" : "button--primary"}`}
            onClick={() => respond(true)}
            autoFocus
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}
