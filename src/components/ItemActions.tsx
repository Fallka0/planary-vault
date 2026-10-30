"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useVault, type Item } from "./VaultProvider";
import { ConfirmDialog, Dialog, NameDialog } from "./Dialog";
import { ShareDialog } from "./ShareDialog";
import { downloadNode, saveBlob } from "@/lib/files";
import { api } from "@/lib/api";
import { wrapKey } from "@/lib/crypto";

type Open = { kind: "rename" | "move" | "share" | "delete"; item: Item } | null;

/** The ⋯ menu entries for a file or folder, plus the dialogs they open. */
export function useItemActions() {
  const vault = useVault();
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);

  const download = async (item: Item) => {
    const blob = await downloadNode(item.id, item.key, item.mime);
    saveBlob(blob, item.name);
    if (item.incoming) void api(`/nodes/${item.id}/viewed`, { method: "POST" }).catch(() => undefined);
  };

  const entries = (item: Item, close: () => void) => {
    const run = (fn: () => void) => () => {
      close();
      fn();
    };
    if (item.trashedAt) {
      return (
        <>
          <button type="button" role="menuitem" onClick={run(() => void vault.setTrashed(item, false))}>
            Restore
          </button>
          <button type="button" role="menuitem" className="danger" onClick={run(() => setOpen({ kind: "delete", item }))}>
            Delete forever
          </button>
        </>
      );
    }
    const owner = !item.incoming;
    const canEdit = owner || item.incoming?.role === "edit";
    return (
      <>
        <button type="button" role="menuitem" onClick={run(() => router.push(item.kind === "folder" ? `/folder/${item.id}` : `/file/${item.id}`))}>
          Open
        </button>
        {item.kind === "file" && (
          <button type="button" role="menuitem" onClick={run(() => void download(item))}>
            Download
          </button>
        )}
        {owner && (
          <button type="button" role="menuitem" onClick={run(() => setOpen({ kind: "share", item }))}>
            Share
          </button>
        )}
        {canEdit && <hr />}
        {canEdit && (
          <button type="button" role="menuitem" onClick={run(() => setOpen({ kind: "rename", item }))}>
            Rename
          </button>
        )}
        {owner && (
          <button type="button" role="menuitem" onClick={run(() => setOpen({ kind: "move", item }))}>
            Move to…
          </button>
        )}
        {owner && (
          <button type="button" role="menuitem" className="danger" onClick={run(() => void vault.setTrashed(item, true))}>
            Move to Trash
          </button>
        )}
      </>
    );
  };

  const dialogs = (
    <>
      {open?.kind === "rename" && (
        <NameDialog
          title={open.item.kind === "folder" ? "Rename folder" : "Rename file"}
          label="Name"
          initial={open.item.name}
          confirm="Rename"
          onSubmit={(name) => vault.updateMeta(open.item, { name })}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === "move" && <MoveDialog item={open.item} onClose={() => setOpen(null)} />}
      {open?.kind === "share" && <ShareDialog item={open.item} onClose={() => setOpen(null)} />}
      {open?.kind === "delete" && (
        <ConfirmDialog
          title="Delete forever?"
          body={`"${open.item.name}" and all its versions will be gone. This can't be undone.`}
          confirm="Delete forever"
          danger
          onConfirm={() => vault.deleteForever(open.item)}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );

  return { entries, dialogs, download, openShare: (item: Item) => setOpen({ kind: "share", item }) };
}

function MoveDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const { items, refresh } = useVault();
  const [target, setTarget] = useState(item.parentId ?? "");
  const [busy, setBusy] = useState(false);

  // A folder can't move into itself or anything inside it.
  const inside = (id: string | null): boolean => {
    for (let at = id; at; at = items.find((i) => i.id === at)?.parentId ?? null) if (at === item.id) return true;
    return false;
  };
  const path = (f: Item): string => {
    const parent = f.parentId ? items.find((i) => i.id === f.parentId) : undefined;
    return parent ? `${path(parent)} / ${f.name}` : f.name;
  };
  const folders = items
    .filter((i) => i.kind === "folder" && !i.trashedAt && !i.incoming && !inside(i.id))
    .map((f) => ({ id: f.id, label: path(f) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <Dialog title="Move to" onClose={onClose} size="sm">
      <form
        className="dialog-body"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          // Re-wrap the key for the new folder, so whoever that folder is shared with can open it.
          const parent = target ? items.find((i) => i.id === target) : undefined;
          await api(`/nodes/${item.id}`, {
            method: "PATCH",
            body: { parentId: target || null, parentKey: parent ? await wrapKey(parent.key, item.key) : undefined },
          });
          await refresh();
          onClose();
        }}
      >
        <div className="field">
          <label htmlFor="move-to">Folder</label>
          <select id="move-to" className="select" style={{ height: 48, borderRadius: 12 }} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">All files</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="actions">
          <button type="submit" className="pill pill-primary" disabled={busy || target === (item.parentId ?? "")}>
            Move
          </button>
          <button type="button" className="pill pill-text" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

