import { type ReactNode, useEffect, useId, useRef } from "react";

/**
 * A CONFIRM slip in a native <dialog>. The confirm button fires once per decision: a second
 * click before the answer arrives does nothing, and while busy it says what is happening.
 */
export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  /** No decision can be sent right now (the answer is unknown, PayPal is not ready...). */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const sent = useRef(false);
  const titleId = useId();
  const busy = props.busy === true;

  useEffect(() => {
    const node = dialog.current;
    if (node === null) {
      return;
    }
    if (props.open && !node.open) {
      node.showModal();
    } else if (!props.open && node.open) {
      node.close();
    }
  }, [props.open]);

  // A new question (a new amount) or an answer re-arms the button.
  useEffect(() => {
    if (!busy) {
      sent.current = false;
    }
  }, [busy, props.confirmLabel]);

  const confirm = () => {
    if (sent.current || busy || props.confirmDisabled) {
      return;
    }
    sent.current = true;
    props.onConfirm();
  };

  return (
    <dialog
      ref={dialog}
      className="slip-dialog"
      aria-labelledby={titleId}
      onClose={props.onClose}
      onCancel={(event) => {
        if (busy) {
          event.preventDefault();
        }
      }}
    >
      <p className="slip-meta">Confirm</p>
      <h2 id={titleId} className="slip-title">
        {props.title}
      </h2>
      {props.children}
      <div className="slip-dialog-actions">
        <button
          type="button"
          className="slip-button"
          data-variant="ink"
          onClick={confirm}
          disabled={busy || props.confirmDisabled === true}
          aria-busy={busy}
        >
          {busy ? (props.busyLabel ?? `${props.confirmLabel}…`) : props.confirmLabel}
        </button>
        <button type="button" className="slip-button" onClick={props.onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
