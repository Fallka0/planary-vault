"use client";

import { useEffect, useRef, useState } from "react";
import { Close } from "./Icons";

/** Esc closes, focus stays inside, and goes back where it was afterwards. */
export function Dialog({
  title,
  onClose,
  size,
  children,
}: {
  title: string;
  onClose: () => void;
  size?: "sm";
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = panel.current!;
    const focusables = () =>
      [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
        (n) => !n.hasAttribute("disabled"),
      );
    (el.querySelector<HTMLElement>("[autofocus]") ?? focusables()[1] ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === "Tab") {
        const list = focusables();
        if (!list.length) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, []);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className={`dialog${size === "sm" ? " dialog-sm" : ""}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-head">
          <h2 id="dialog-title">{title}</h2>
          <button type="button" className="dialog-close" aria-label="Close" onClick={onClose}>
            <Close />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** One text field and a confirm button: new folder, rename. */
export function NameDialog({
  title,
  label,
  initial = "",
  confirm,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  confirm: string;
  onSubmit: (value: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog title={title} onClose={onClose} size="sm">
      <form
        className="dialog-body"
        onSubmit={async (e) => {
          e.preventDefault();
          const v = value.trim();
          if (!v) return;
          setBusy(true);
          try {
            await onSubmit(v);
            onClose();
          } catch {
            setError("That didn't work. Try again.");
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label htmlFor="name-field">{label}</label>
          <input
            id="name-field"
            className="input"
            autoFocus
            value={value}
            maxLength={200}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => {
              // Select the name without its extension, like a file manager.
              const dot = e.target.value.lastIndexOf(".");
              e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
            }}
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="actions">
          <button type="submit" className="pill pill-primary" disabled={busy || !value.trim()}>
            {confirm}
          </button>
          <button type="button" className="pill pill-text" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirm,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirm: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={title} onClose={onClose} size="sm">
      <div className="dialog-body">
        <p>{body}</p>
        <div className="actions">
          <button
            type="button"
            className={`pill ${danger ? "pill-danger" : "pill-primary"}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } catch {
                setBusy(false);
              }
            }}
          >
            {confirm}
          </button>
          <button type="button" className="pill pill-text" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  );
}
