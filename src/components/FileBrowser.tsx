"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { countFiles, useVault, type Item } from "./VaultProvider";
import { useItemActions } from "./ItemActions";
import { useUploadPicker } from "./AppShell";
import { NameDialog } from "./Dialog";
import { NOTE_MIME, notePage } from "./RichNote";
import { useDragMove } from "./useDragMove";
import { Menu } from "./Menu";
import { ChevronDown, Folder, GridIcon, ListIcon, Lock, More } from "./Icons";
import { formatBytes, formatShortDate, initials, shownName, typeBadge } from "@/lib/format";

export type Scope =
  | { kind: "all" }
  | { kind: "recent" }
  | { kind: "shared" }
  | { kind: "trash" }
  | { kind: "folder"; id: string }
  | { kind: "tag"; tag: string };

type Sort = "modified" | "name" | "size";
type SearchIn = "all" | "shared" | "trash";

const SORTS: Record<Sort, string> = { modified: "Last modified", name: "Name", size: "Size" };
const VIEW_KEY = "planary.vault.view";

/** List or grid, remembered per browser. */
const viewListeners = new Set<() => void>();
let viewFallback: "list" | "grid" = "list";

function readView(): "list" | "grid" {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list";
  } catch {
    return viewFallback;
  }
}

function writeView(v: "list" | "grid") {
  viewFallback = v;
  try {
    window.localStorage.setItem(VIEW_KEY, v);
  } catch {
    // Remembering is a convenience.
  }
  viewListeners.forEach((l) => l());
}

function subscribeView(listener: () => void) {
  viewListeners.add(listener);
  return () => viewListeners.delete(listener);
}

/** A trashed item shows in Trash only if its parent isn't trashed too. */
function topTrashed(items: Map<string, Item>, i: Item) {
  return !!i.trashedAt && !(i.parentId && items.get(i.parentId)?.trashedAt);
}

function isTrashed(items: Map<string, Item>, i: Item): boolean {
  for (let at: Item | undefined = i; at; at = at.parentId ? items.get(at.parentId) : undefined) if (at.trashedAt) return true;
  return false;
}

export function FileBrowser({ scope }: { scope: Scope }) {
  const { items, byId, query, setQuery, setCurrentFolder, createFolder, saveNote } = useVault();
  const router = useRouter();
  const actions = useItemActions();
  const picker = useUploadPicker();
  const view = useSyncExternalStore(subscribeView, readView, () => "list" as const);
  const [now] = useState(Date.now);
  const [sort, setSort] = useState<Sort>("modified");
  const [searchIn, setSearchIn] = useState<SearchIn>("all");
  const [newFolder, setNewFolder] = useState(false);
  const [newNote, setNewNote] = useState(false);
  const { dragProps, dropProps } = useDragMove();
  // Files and folders are picked up anywhere; folders also take what's dropped on them.
  const dnd = (i: Item) => ({ ...dragProps(i), ...(i.kind === "folder" && !i.incoming && !i.trashedAt ? dropProps(i.id) : {}) });

  const folderId = scope.kind === "folder" ? scope.id : null;
  useEffect(() => {
    setCurrentFolder(folderId);
    return () => setCurrentFolder(null);
  }, [folderId, setCurrentFolder]);

  const folder = scope.kind === "folder" ? byId.get(scope.id) : undefined;
  const q = query.trim().toLowerCase();

  const list = useMemo(() => {
    let out: Item[];
    if (q) {
      // Client-side index: names, folder names and tags. Nothing else is decrypted, so nothing else is searched.
      const pathOf = (i: Item) => {
        const names: string[] = [];
        for (let p = i.parentId ? byId.get(i.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) names.push(p.name);
        return names.join(" ").toLowerCase();
      };
      const terms = q.split(/\s+/);
      out = items.filter((i) => {
        if (searchIn === "shared" && !i.incoming) return false;
        if (searchIn === "trash" ? !isTrashed(byId, i) : isTrashed(byId, i)) return false;
        const hay = `${i.name} ${i.tags.join(" ")} ${pathOf(i)}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    } else {
      switch (scope.kind) {
        case "all":
          out = items.filter((i) => !i.parentId && !i.trashedAt && !i.incoming);
          break;
        case "folder":
          out = items.filter((i) => i.parentId === scope.id && !i.trashedAt);
          break;
        case "shared":
          // What was shared with you; the contents of shared folders stay inside them.
          out = items.filter((i) => i.incoming && !i.parentId);
          break;
        case "trash":
          out = items.filter((i) => topTrashed(byId, i));
          break;
        case "tag":
          out = items.filter((i) => i.tags.includes(scope.tag) && !isTrashed(byId, i));
          break;
        case "recent": {
          const since = now - 30 * 86_400_000;
          out = items
            .filter((i) => i.kind === "file" && i.updatedAt > since && !isTrashed(byId, i))
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, 50);
          return out;
        }
      }
    }
    const by: Record<Sort, (a: Item, b: Item) => number> = {
      modified: (a, b) => b.updatedAt - a.updatedAt,
      name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
      size: (a, b) => b.size - a.size,
    };
    // Folders first, like every file manager.
    return out.sort((a, b) => (a.kind === b.kind ? by[sort](a, b) : a.kind === "folder" ? -1 : 1));
  }, [items, byId, scope, q, sort, searchIn, now]);

  const title = q
    ? "Results."
    : scope.kind === "all"
      ? "All files"
      : scope.kind === "recent"
        ? "Recent"
        : scope.kind === "shared"
          ? "Shared with me"
          : scope.kind === "trash"
            ? "Trash"
            : scope.kind === "tag"
              ? scope.tag
              : (folder?.name ?? "Folder");

  const crumbs: Item[] = [];
  for (let p = folder?.parentId ? byId.get(folder.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) crumbs.unshift(p);

  const changeView = writeView;

  const href = (i: Item) => (i.kind === "folder" ? `/folder/${i.id}` : `/file/${i.id}`);
  const meta = (i: Item) => (i.kind === "folder" ? `${countFiles(items, i.id)} files` : formatBytes(i.size));
  const people = (i: Item) => (i.incoming ? [i.incoming.ownerName] : i.sharedWith);

  const searchChips = q ? (
    <div className="search-in">
      <span>Search in</span>
      {(["all", "shared", "trash"] as const).map((s) => (
        <button key={s} type="button" className={`chip${searchIn === s ? " is-active" : ""}`} aria-pressed={searchIn === s} onClick={() => setSearchIn(s)}>
          {s === "all" ? "All files" : s === "shared" ? "Shared with me" : "Trash"}
        </button>
      ))}
    </div>
  ) : null;

  if (q && !list.length) {
    return (
      <>
        {searchChips}
        <div className="no-results fade-in">
          <h1>No results.</h1>
          <div className="notice">
            <Lock />
            Search covers names, folders and tags only.
          </div>
          <div className="actions" style={{ marginTop: 0 }}>
            <button type="button" className="pill pill-primary" onClick={() => setQuery("")}>
              Clear search
            </button>
            {searchIn !== "trash" && (
              <button type="button" className="pill pill-text" onClick={() => setSearchIn("trash")}>
                Search Trash
              </button>
            )}
          </div>
        </div>
      </>
    );
  }

  const vaultEmpty = scope.kind === "all" && !q && !items.some((i) => !i.incoming);

  return (
    <>
      {searchChips}
      <div className="view" style={q ? { paddingTop: 36 } : undefined}>
        {vaultEmpty ? (
          <div className="empty reveal">
            <h2>No files yet.</h2>
            <div className="actions" style={{ marginTop: 0 }}>
              <button type="button" className="pill pill-primary pill-lg" onClick={picker.open}>
                Choose files
              </button>
              <button type="button" className="pill pill-text" onClick={() => setNewNote(true)}>
                New note
              </button>
              <button type="button" className="pill pill-text" onClick={() => setNewFolder(true)}>
                New folder
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="view-head">
              <div>
                {crumbs.length > 0 || folder ? (
                  <nav className="crumbs" aria-label="Folder path">
                    {folder?.incoming ? (
                      <Link href="/shared">Shared with me</Link>
                    ) : (
                      <Link href="/" {...dropProps(null)}>
                        All files
                      </Link>
                    )}
                    {crumbs.map((c) => (
                      <span key={c.id} style={{ display: "contents" }}>
                        <span aria-hidden="true">/</span>
                        <Link href={`/folder/${c.id}`} {...dropProps(c.id)}>
                          {c.name}
                        </Link>
                      </span>
                    ))}
                  </nav>
                ) : null}
                <h1 className="reveal">{title}</h1>
              </div>
              <div className="view-tools">
                <span className="encrypted m-only">
                  <Lock />
                  Encrypted
                </span>
                {(scope.kind === "all" || (scope.kind === "folder" && !folder?.incoming)) && (
                  <button type="button" className="pill pill-outline pill-md" onClick={() => setNewNote(true)}>
                    New note
                  </button>
                )}
                {scope.kind === "folder" && !folder?.incoming && (
                  <button type="button" className="pill pill-outline pill-md d-only" onClick={() => setNewFolder(true)}>
                    New folder
                  </button>
                )}
                {scope.kind !== "recent" && (
                  <div className="sort">
                    <Menu
                      label={`Sort: ${SORTS[sort]}`}
                      className="pill pill-outline pill-md"
                      trigger={
                        <>
                          {SORTS[sort]}
                          <ChevronDown />
                        </>
                      }
                    >
                      {(close) =>
                        (Object.keys(SORTS) as Sort[]).map((s) => (
                          <button
                            key={s}
                            type="button"
                            role="menuitemradio"
                            aria-checked={sort === s}
                            onClick={() => {
                              setSort(s);
                              close();
                            }}
                          >
                            {SORTS[s]}
                          </button>
                        ))
                      }
                    </Menu>
                  </div>
                )}
                <div className="seg seg-icons" role="group" aria-label="View">
                  <button type="button" aria-label="List view" aria-pressed={view === "list"} onClick={() => changeView("list")}>
                    <ListIcon />
                  </button>
                  <button type="button" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => changeView("grid")}>
                    <GridIcon />
                  </button>
                </div>
              </div>
            </div>

            <div className="m-filters m-only" role="group" aria-label="Library">
              {(
                [
                  ["/", "All", "all"],
                  ["/recent", "Recent", "recent"],
                  ["/shared", "Shared with me", "shared"],
                  ["/trash", "Trash", "trash"],
                ] as const
              ).map(([path, label, kind]) => (
                <Link key={path} href={path} className={`pill ${scope.kind === kind ? "pill-primary" : "pill-outline"}`} aria-current={scope.kind === kind ? "page" : undefined}>
                  {label}
                </Link>
              ))}
            </div>

            {!list.length ? (
              <p className="empty-note fade-in">
                {scope.kind === "trash"
                  ? "Trash is empty."
                  : scope.kind === "shared"
                    ? "Nothing shared with you yet."
                    : scope.kind === "recent"
                      ? "Nothing changed in the last 30 days."
                      : "This folder is empty."}
              </p>
            ) : view === "list" ? (
              <div className="panel list fade-in" key="list">
                <div className="list-inner" role="table" aria-label={title}>
                  <div className="list-row list-head" role="row">
                    <span role="columnheader">Name</span>
                    <span role="columnheader">Tags</span>
                    <span role="columnheader">Shared</span>
                    <span role="columnheader">Modified</span>
                    <span role="columnheader" className="list-size">
                      Size
                    </span>
                    <span />
                  </div>
                  {list.map((i) => (
                    <div
                      key={i.id}
                      className={`list-row${i.trashedAt ? " is-dimmed" : ""}`}
                      role="row"
                      {...dnd(i)}
                      onClick={(e) => {
                        if (!(e.target as HTMLElement).closest("a, button") && !i.trashedAt) router.push(href(i));
                      }}
                    >
                      <Link href={i.trashedAt ? "#" : href(i)} className="list-name" role="cell" onClick={(e) => i.trashedAt && e.preventDefault()}>
                        {i.kind === "folder" ? (
                          <span className="m-icon">
                            <Folder />
                          </span>
                        ) : (
                          <span className="badge">{typeBadge(i.name, i.mime)}</span>
                        )}
                        <span className="d-only" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {shownName(i.name, i.mime)}
                        </span>
                        <span className="m-two m-only">
                          <span>{shownName(i.name, i.mime)}</span>
                          <span>{i.kind === "folder" ? meta(i) : `${formatShortDate(i.updatedAt)} · ${meta(i)}`}</span>
                        </span>
                      </Link>
                      <span className="list-tags" role="cell">
                        {i.tags.slice(0, 2).map((t) => (
                          <span key={t} className="chip">
                            {t}
                          </span>
                        ))}
                      </span>
                      <span role="cell" className="avatars m-shared">
                        {people(i)
                          .slice(0, 3)
                          .map((n) => (
                            <span key={n} className="avatar avatar-shared" title={i.incoming ? `Shared by ${n}` : `Shared with ${n}`}>
                              {initials(n)}
                            </span>
                          ))}
                      </span>
                      <span role="cell" className="list-meta">
                        {formatShortDate(i.trashedAt ?? i.updatedAt)}
                      </span>
                      <span role="cell" className="list-meta list-size">
                        {meta(i)}
                      </span>
                      <Menu label={`More actions for ${i.name}`} trigger={<More />}>
                        {(close) => actions.entries(i, close)}
                      </Menu>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid fade-in" key="grid">
                {list.map((i) => (
                  <div key={i.id} className="card" {...dnd(i)}>
                    <div className="card-thumb">{i.kind === "folder" ? <Folder /> : typeBadge(i.name, i.mime)}</div>
                    <div className="card-text">
                      <Link href={i.trashedAt ? "#" : href(i)} className="card-name" style={{ position: "static" }}>
                        <span style={{ position: "absolute", inset: 0, borderRadius: 20 }} aria-hidden="true" />
                        {shownName(i.name, i.mime)}
                      </Link>
                      <span className="card-meta">
                        {formatShortDate(i.updatedAt)} · {meta(i)}
                      </span>
                    </div>
                    <Menu label={`More actions for ${i.name}`} className="icon-btn icon-btn-filled" trigger={<More />}>
                      {(close) => actions.entries(i, close)}
                    </Menu>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {picker.element}
      {actions.dialogs}
      {newFolder && (
        <NameDialog
          title="New folder"
          label="Name"
          confirm="Create"
          onSubmit={async (name) => {
            await createFolder(name, scope.kind === "folder" ? scope.id : null);
          }}
          onClose={() => setNewFolder(false)}
        />
      )}
      {newNote && (
        <NameDialog
          title="New note"
          label="Title"
          confirm="Create"
          onSubmit={async (title) => {
            // A note is an encrypted HTML page, so it keeps its formatting and opens in any browser once downloaded.
            const name = /\.html?$/i.test(title) ? title : `${title}.html`;
            const id = await saveNote(notePage(title.replace(/\.html?$/i, ""), ""), { name, parentId: scope.kind === "folder" ? scope.id : null }, NOTE_MIME);
            router.push(`/file/${id}`);
          }}
          onClose={() => setNewNote(false)}
        />
      )}
    </>
  );
}
