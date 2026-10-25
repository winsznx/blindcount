"use client";

import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE = "input, button, select, textarea, a[href], [tabindex]:not([tabindex='-1'])";

export function Dialog({ open, onClose, title, children, labelledBy = "dialog-title" }: { open: boolean; onClose: () => void; title: string; children: ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Latest onClose without re-running the focus effect, so typing never bounces focus around.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Focus management, the focus trap and Escape handling act on the DOM outside React's render.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onCloseRef.current();
      if (e.key !== "Tab" || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("disabled"));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={ref}>
        <h2 id={labelledBy} style={{ fontSize: 20 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
