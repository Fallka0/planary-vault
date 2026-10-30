"use client";

import { useEffect, useRef, useState } from "react";

/** A small popover menu. Closes on outside click, Esc, or picking an item. */
export function Menu({
  trigger,
  label,
  children,
  className = "icon-btn icon-btn-ghost",
}: {
  trigger: React.ReactNode;
  label: string;
  children: (close: () => void) => React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    wrap.current?.querySelector<HTMLElement>('[role="menu"] button, [role="menu"] a')?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      className="menu-wrap"
      ref={wrap}
      onClick={(e) => {
        // Rows are links; the menu must not open them.
        e.stopPropagation();
      }}
    >
      <button
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
      >
        {trigger}
      </button>
      {open && (
        <div className="menu" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
