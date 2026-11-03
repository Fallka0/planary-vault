"use client";

import { useState, type DragEvent } from "react";
import { useVault, type Item } from "./VaultProvider";

/** Our own drags carry this type; files dragged in from the desktop don't, so they still upload. */
const TYPE = "application/x-planary-node";

// The item being dragged. dragover can't read the payload, so targets check against this.
let dragging: Item | null = null;

/**
 * Drag a file or folder onto a folder (or "All files") to move it there, the same move as
 * "Move to…". `dragProps` goes on what can be picked up, `dropProps` on where it can land;
 * `over` names the target under the pointer, for highlighting it.
 */
export function useDragMove() {
  const { canMove, moveItem } = useVault();
  const [over, setOver] = useState<string | null>(null);

  const dragProps = (item: Item) =>
    item.incoming || item.trashedAt
      ? {}
      : {
          draggable: true,
          onDragStart: (e: DragEvent) => {
            dragging = item;
            e.dataTransfer.setData(TYPE, item.id);
            e.dataTransfer.effectAllowed = "move";
            (e.currentTarget as HTMLElement).classList.add("is-dragging");
          },
          onDragEnd: (e: DragEvent) => {
            dragging = null;
            (e.currentTarget as HTMLElement).classList.remove("is-dragging");
          },
        };

  /** `target`: a folder id, or null for All files. */
  const dropProps = (target: string | null) => {
    const key = target ?? "root";
    const ok = (e: DragEvent) => e.dataTransfer.types.includes(TYPE) && !!dragging && canMove(dragging, target);
    return {
      onDragOver: (e: DragEvent) => {
        if (!ok(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (over !== key) setOver(key);
      },
      onDragLeave: (e: DragEvent) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setOver((o) => (o === key ? null : o));
      },
      onDrop: (e: DragEvent) => {
        setOver(null);
        if (!ok(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const item = dragging;
        dragging = null;
        if (item) void moveItem(item, target);
      },
      "data-drop": over === key ? "" : undefined,
    };
  };

  return { dragProps, dropProps };
}
