import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { IconDotsVertical } from "./icons";

export type MenuItem =
  | { type: "action"; label: string; icon?: React.ReactNode; onClick: () => void; danger?: boolean }
  | { type: "link";   label: string; icon?: React.ReactNode; to: string; danger?: boolean }
  | { type: "submit"; label: string; icon?: React.ReactNode; formAction?: string; name?: string; value?: string; danger?: boolean }
  | { type: "sep" };

interface DotMenuProps {
  items: MenuItem[];
  align?: "right" | "left";
}

export function DotMenu({ items, align = "right" }: DotMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  function openMenu(e: React.MouseEvent) {
    e.stopPropagation();
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: align === "left" ? r.left : r.right - 164 });
    setOpen(v => !v);
  }

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (
        dropRef.current && !dropRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    function onScroll() { setOpen(false); }
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const cls = (danger?: boolean) => `dot-item${danger ? " danger" : ""}`;

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button ref={btnRef} type="button" className="dot-trigger" onClick={openMenu}
        aria-label="More options" aria-expanded={open}>
        <IconDotsVertical size={16} />
      </button>
      {open && (
        <div ref={dropRef} className="dot-dropdown"
          style={{ position: "fixed", top: pos.top, left: pos.left, right: "auto" }}
          onClick={(e) => e.stopPropagation()}>
          {items.map((item, i) => {
            if (item.type === "sep") return <hr key={i} className="dot-sep" />;
            if (item.type === "link") return (
              <Link key={i} to={item.to} className={cls(item.danger)} onClick={() => setOpen(false)}>
                {item.icon && <span style={{ opacity: 0.7, flexShrink: 0, display: "flex" }}>{item.icon}</span>}
                {item.label}
              </Link>
            );
            if (item.type === "submit") return (
              <button key={i} type="submit" form={item.formAction} name={item.name} value={item.value}
                className={cls(item.danger)} onClick={() => setOpen(false)}>
                {item.icon && <span style={{ opacity: 0.7, flexShrink: 0, display: "flex" }}>{item.icon}</span>}
                {item.label}
              </button>
            );
            return (
              <button key={i} type="button" className={cls(item.danger)}
                onClick={() => { item.onClick(); setOpen(false); }}>
                {item.icon && <span style={{ opacity: 0.7, flexShrink: 0, display: "flex" }}>{item.icon}</span>}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
