"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const GAP = 6;
const EDGE = 8;

/** A small popover menu. Closes on outside click, Esc, scroll, resize, or picking an item.
 *  It's rendered into <body> with fixed positioning so scrolling containers (the file list)
 *  can't clip it, and it opens upwards when there's no room below. */
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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const b = button.current?.getBoundingClientRect();
    const m = menu.current?.getBoundingClientRect();
    if (!b || !m) return;
    const below = b.bottom + GAP + m.height <= window.innerHeight - EDGE;
    const top = below ? b.bottom + GAP : Math.max(EDGE, b.top - GAP - m.height);
    const left = Math.min(Math.max(EDGE, b.right - m.width), window.innerWidth - EDGE - m.width);
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      button.current?.focus();
    };
    const onScroll = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    menu.current?.querySelector<HTMLElement>("button, a")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <div
      className="menu-wrap"
      onClick={(e) => {
        // Rows are links; the menu must not open them.
        e.stopPropagation();
      }}
    >
      <button
        ref={button}
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
      {open &&
        createPortal(
          <div
            ref={menu}
            className="menu"
            role="menu"
            // Measured first (hidden), then placed.
            style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
            // Portalled, but React still bubbles events up the component tree to the row link.
            onClick={(e) => e.stopPropagation()}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </div>
  );
}
