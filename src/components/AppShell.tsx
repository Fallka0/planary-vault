"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { countFiles, useVault } from "./VaultProvider";
import { Lockup } from "./Logo";
import { Close, Folder, Lock, Menu as MenuIcon, Plus, Search } from "./Icons";
import { UploadQueue } from "./UploadQueue";
import { formatBytes, formatProgress, initials } from "@/lib/format";

export function useUploadPicker() {
  const { enqueue, currentFolder } = useVault();
  const input = useRef<HTMLInputElement>(null);
  const element = (
    <input
      ref={input}
      type="file"
      multiple
      hidden
      onChange={(e) => {
        const files = [...(e.target.files ?? [])];
        if (files.length) enqueue(files, currentFolder);
        e.target.value = "";
      }}
    />
  );
  return { open: () => input.current?.click(), element };
}

function StorageMeter({ compact }: { compact?: boolean }) {
  const { used, plan } = useVault();
  const pct = Math.min(100, (used / plan.quota) * 100);
  return (
    <div className="storage">
      {compact ? (
        <div className="storage-line">
          <span className="hint">{formatProgress(used, plan.quota)}</span>
        </div>
      ) : (
        <div className="storage-line">
          <span style={{ fontWeight: 600 }}>{used ? formatBytes(used) : "0 GB"}</span>
          <span className="hint">of {formatBytes(plan.quota)}</span>
        </div>
      )}
      <div className="storage-bar" role="img" aria-label={`${Math.round(pct)}% of storage used`}>
        <div className="fill-once" style={{ width: `${Math.max(pct, used > 0 ? 1 : 0)}%` }} />
      </div>
    </div>
  );
}

function Sidebar({ open, onClose, onUpload }: { open: boolean; onClose: () => void; onUpload: () => void }) {
  const { items, createFolder, lock } = useVault();
  const pathname = usePathname();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const folders = useMemo(
    () => items.filter((i) => i.kind === "folder" && !i.parentId && !i.trashedAt && !i.incoming).sort((a, b) => a.name.localeCompare(b.name)),
    [items],
  );
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of items) if (!i.trashedAt) for (const t of i.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [items]);
  const sharedCount = items.filter((i) => i.incoming && !i.parentId).length;

  const link = (href: string, label: React.ReactNode, count?: number) => (
    <Link href={href} aria-current={pathname === href ? "page" : undefined} onClick={onClose}>
      {label}
      {count ? <span className="count">{count}</span> : null}
    </Link>
  );

  return (
    <aside className={`sidebar${open ? " is-open" : ""}`} aria-label="Vault">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Lockup />
        <div className="m-only" style={{ gap: 6 }}>
          <button type="button" className="icon-btn" aria-label="Lock vault" onClick={lock}>
            <Lock />
          </button>
          <button type="button" className="icon-btn icon-btn-filled" aria-label="Close menu" onClick={onClose}>
            <Close />
          </button>
        </div>
      </div>
      <button
        type="button"
        className="pill pill-primary d-only"
        style={{ alignSelf: "flex-start", height: 42 }}
        onClick={() => {
          onClose();
          onUpload();
        }}
      >
        <Plus />
        Upload
      </button>
      <nav className="nav" aria-label="Library">
        {link("/", "All files")}
        {link("/recent", "Recent")}
        {link("/shared", <span style={{ flex: 1 }}>Shared with me</span>, sharedCount)}
        {link("/trash", "Trash")}
        <Link href="/settings" className="m-only" onClick={onClose}>
          Settings
        </Link>
      </nav>
      <div className="nav folders">
        <div className="nav-head">
          <span className="nav-title">Folders</span>
          <button type="button" className="nav-add" aria-label="New folder" onClick={() => setAdding(true)}>
            <Plus />
          </button>
        </div>
        {folders.map((f) => (
          <Link key={f.id} href={`/folder/${f.id}`} aria-current={pathname === `/folder/${f.id}` ? "page" : undefined} onClick={onClose}>
            <Folder />
            <span>{f.name}</span>
            <span className="count">{countFiles(items, f.id)}</span>
          </Link>
        ))}
        {adding && (
          <form
            className="folder-new"
            onSubmit={async (e) => {
              e.preventDefault();
              const n = name.trim();
              if (n) await createFolder(n, null);
              setName("");
              setAdding(false);
            }}
          >
            <Folder />
            <label htmlFor="new-folder" className="sr-only">
              Folder name
            </label>
            <input
              id="new-folder"
              autoFocus
              placeholder="Folder name"
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => !name.trim() && setAdding(false)}
              onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
            />
          </form>
        )}
        {!folders.length && !adding && <span className="hint" style={{ fontSize: 15 }}>No folders yet.</span>}
      </div>
      {tags.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="nav-title">Tags</span>
          <div className="tag-list">
            {tags.map((t) => (
              <Link
                key={t}
                href={`/tag/${encodeURIComponent(t)}`}
                className={`chip${pathname === `/tag/${encodeURIComponent(t)}` ? " is-active" : ""}`}
                onClick={onClose}
              >
                {t}
              </Link>
            ))}
          </div>
        </div>
      )}
      <StorageMeter />
    </aside>
  );
}

function SearchBox() {
  const { query, setQuery } = useVault();
  return (
    <label className={`search${query ? " is-active" : ""}`}>
      <Search />
      <input
        type="search"
        aria-label="Search"
        placeholder="Search names, folders and tags"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setQuery("")}
      />
      {query && (
        <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setQuery("")}>
          <Close />
        </button>
      )}
    </label>
  );
}

/** Shows on dragenter anywhere in the window. */
function useDropZone(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const onFilesRef = useRef(onFiles);
  useEffect(() => {
    onFilesRef.current = onFiles;
  });
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const overEv = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.size > 0 || f.type);
      if (files.length) onFilesRef.current(files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overEv);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overEv);
      window.removeEventListener("drop", drop);
    };
  }, []);
  return over;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, lock, enqueue, currentFolder } = useVault();
  const router = useRouter();
  const picker = useUploadPicker();
  const [menuOpen, setMenuOpen] = useState(false);
  const dragging = useDropZone((files) => enqueue(files, currentFolder));

  return (
    <div className="shell">
      {picker.element}
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} onUpload={picker.open} />
      <section className="content">
        <div className="m-head m-only">
          <Lockup />
          <div className="m-head-actions">
            <button type="button" className="icon-btn" aria-label="Lock vault" onClick={lock}>
              <Lock />
            </button>
            <button type="button" className="icon-btn icon-btn-filled" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
              <MenuIcon />
            </button>
          </div>
        </div>
        <div className="topbar">
          <SearchBox />
          <div className="topbar-right">
            <span className="encrypted">
              <Lock />
              Encrypted
            </span>
            <button type="button" className="icon-btn" aria-label="Lock vault" onClick={lock}>
              <Lock />
            </button>
            <button type="button" className="avatar-btn" aria-label="Settings" onClick={() => router.push("/settings")}>
              {initials(user.name || user.email)}
            </button>
          </div>
        </div>
        {children}
      </section>
      <div className="m-dock m-only">
        <StorageMeter compact />
        <button type="button" className="pill pill-primary" onClick={picker.open}>
          <Plus />
          Upload
        </button>
      </div>
      {dragging && (
        <div className="drop" aria-hidden="true">
          <div className="drop-zone">
            <p>Drop to upload.</p>
          </div>
        </div>
      )}
      <UploadQueue />
    </div>
  );
}
