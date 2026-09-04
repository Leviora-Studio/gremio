// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/** Position existing app menus outside scroll containers without changing their design. */
export function AnchoredPopover({ anchor, children, width, enabled = true }: { anchor: RefObject<HTMLDivElement | null>; children: ReactNode; width?: number; enabled?: boolean }) {
  const [style, setStyle] = useState<React.CSSProperties>();
  useLayoutEffect(() => {
    if (!enabled) return;
    const update = () => {
      if (!anchor.current) return;
      const rect = anchor.current.getBoundingClientRect();
      const size = Math.min(width ?? rect.width, window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom - 8;
      const above = rect.top - 8;
      const upwards = below < 300 && above > below;
      setStyle({ position: "fixed", width: size, left: Math.max(8, Math.min(rect.left, window.innerWidth - size - 8)), ...(upwards ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }), maxHeight: Math.max(80, upwards ? above - 4 : below - 4), overflowY: "auto", zIndex: 100 });
    };
    update(); window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [anchor, width, enabled]);
  if (!enabled) return children;
  return style ? createPortal(<div data-app-popover style={style}>{children}</div>, document.body) : null;
}
