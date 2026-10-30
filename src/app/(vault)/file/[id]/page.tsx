"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useVault, type Item } from "@/components/VaultProvider";
import { useItemActions } from "@/components/ItemActions";
import { Preview, type Decrypted } from "@/components/Preview";
import { ShareDialog } from "@/components/ShareDialog";
import { Menu } from "@/components/Menu";
import { ArrowUpRight, ChevronLeft, Close, Download, Lock, More } from "@/components/Icons";
import { api, type ActivityRecord, type ShareRecord, type VersionRecord } from "@/lib/api";
import { downloadNode, saveBlob, type FileMeta } from "@/lib/files";
import { sealJson } from "@/lib/crypto";
import { formatBytes, formatDay, formatLongDate, formatStamp, initials, typeLabel } from "@/lib/format";
import { CHUNK_SIZE, TAG_SIZE } from "../../../../../shared/plans";

type Tab = "details" | "versions" | "activity";

/** Versions are stored as ciphertext; the plaintext size follows from the chunk layout. */
function plainSize(cipher: number) {
  return Math.max(0, cipher - Math.ceil(cipher / (CHUNK_SIZE + TAG_SIZE)) * TAG_SIZE);
}

export default function FilePage() {
  const { id } = useParams<{ id: string }>();
  const { byId, items } = useVault();
  const router = useRouter();
  const item = byId.get(id);

  useEffect(() => {
    // Gone (deleted, unshared) or a folder: back to the list.
    if (items.length && (!item || item.kind === "folder")) router.replace(item ? `/folder/${item.id}` : "/");
  }, [item, items.length, router]);

  if (!item || item.kind !== "file") return null;
  // A new version means new bytes: remount the preview.
  return <FileView key={`${item.id}:${item.version}`} item={item} />;
}

function FileView({ item }: { item: Item }) {
  const { byId, user, enqueue, refresh } = useVault();
  const router = useRouter();
  const actions = useItemActions();
  const [tab, setTab] = useState<Tab>("details");
  const [decrypted, setDecrypted] = useState<Decrypted | null>(null);
  const [sharing, setSharing] = useState(false);
  const versionInput = useRef<HTMLInputElement>(null);

  const owner = !item.incoming;
  const canEdit = owner || item.incoming?.role === "edit";
  const folder = item.parentId ? byId.get(item.parentId) : undefined;
  const back = folder ? `/folder/${folder.id}` : item.incoming ? "/shared" : "/";

  // Back to the list once it moves to Trash.
  useEffect(() => {
    if (item.trashedAt) router.replace(back);
  }, [item.trashedAt, back, router]);

  useEffect(() => {
    if (item.incoming) void api(`/nodes/${item.id}/viewed`, { method: "POST" }).catch(() => undefined);
  }, [item.id, item.incoming]);

  const load = useCallback((onProgress: (d: number, t: number) => void) => downloadNode(item.id, item.key, item.mime, undefined, onProgress), [item]);

  const onReady = useCallback((d: Decrypted) => setDecrypted(d), []);

  const download = () => decrypted && saveBlob(decrypted.blob, item.name);

  return (
    <div className="detail">
      <header className="detail-head">
        <Link href={back} className="icon-btn" aria-label={`Back to ${folder?.name ?? (item.incoming ? "Shared with me" : "All files")}`}>
          <ChevronLeft />
        </Link>
        <h1 title={item.name}>{item.name}</h1>
        <div className="detail-actions">
          <button type="button" className="pill pill-outline" disabled={!decrypted} onClick={download}>
            {decrypted && <Download />}
            Download
          </button>
          {owner && (
            <button type="button" className="pill pill-primary" disabled={!decrypted} onClick={() => setSharing(true)}>
              Share
            </button>
          )}
          <Menu label="More actions" className="icon-btn" trigger={<More />}>
            {(close) => (
              <>
                {canEdit && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      versionInput.current?.click();
                    }}
                  >
                    Upload new version
                  </button>
                )}
                {actions.entries(item, close)}
              </>
            )}
          </Menu>
          <input
            ref={versionInput}
            type="file"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) enqueue([file], item.parentId, item);
              e.target.value = "";
            }}
          />
        </div>
      </header>

      <div className="detail-body">
        <Preview name={item.name} mime={item.mime} load={load} onReady={onReady} />
        <aside className="side">
          <div className="seg" role="tablist" aria-label="File info">
            {(["details", "versions", "activity"] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} aria-controls={`panel-${t}`} id={`tab-${t}`} onClick={() => setTab(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div key={tab} id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {tab === "details" && <Details item={item} decrypted={decrypted} folderName={folder?.name} canEdit={canEdit} owner={owner} userName={user.name} />}
            {tab === "versions" && <Versions item={item} canEdit={canEdit} onRestored={refresh} />}
            {tab === "activity" && <Activity item={item} userName={user.name} />}
          </div>
        </aside>
      </div>

      <div className="m-bar m-only">
        <button type="button" className="pill pill-outline" disabled={!decrypted} onClick={download}>
          <Download />
          Download
        </button>
        {owner && (
          <button type="button" className="pill pill-primary" disabled={!decrypted} onClick={() => setSharing(true)}>
            Share
          </button>
        )}
      </div>

      {sharing && <ShareDialog item={item} onClose={() => setSharing(false)} />}
      {actions.dialogs}
    </div>
  );
}

function Details({
  item,
  decrypted,
  folderName,
  canEdit,
  owner,
  userName,
}: {
  item: Item;
  decrypted: Decrypted | null;
  folderName?: string;
  canEdit: boolean;
  owner: boolean;
  userName: string;
}) {
  const { updateMeta } = useVault();
  const [people, setPeople] = useState<ShareRecord[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [tag, setTag] = useState("");
  const isImage = item.mime.startsWith("image/");
  const pages = decrypted?.pages ?? (item.meta as FileMeta).pages;

  useEffect(() => {
    if (owner && item.sharedWith.length) void api<{ people: ShareRecord[] }>(`/nodes/${item.id}/shares`).then((r) => setPeople(r.people));
  }, [owner, item.id, item.sharedWith.length]);

  const addTag = async () => {
    const t = tag.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 32);
    setTag("");
    setAdding(false);
    if (t && !item.tags.includes(t)) await updateMeta(item, { tags: [...item.tags, t] });
  };

  return (
    <>
      <dl className="panel dl">
        <div>
          <dt>Type</dt>
          <dd>{typeLabel(item.name, item.mime, pages)}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(item.size)}</dd>
        </div>
        <div>
          <dt>{item.incoming ? "Shared by" : "Folder"}</dt>
          <dd>{item.incoming ? item.incoming.ownerName : (folderName ?? "All files")}</dd>
        </div>
        <div>
          <dt>Added</dt>
          <dd>{formatLongDate(item.createdAt)}</dd>
        </div>
        <div>
          <dt>Modified</dt>
          <dd>{formatLongDate(item.updatedAt)}</dd>
        </div>
        {isImage && (
          <div>
            <dt>Dimensions</dt>
            {decrypted?.width ? (
              <dd>
                {decrypted.width} × {decrypted.height}
              </dd>
            ) : (
              <dd className="is-muted">After decrypting</dd>
            )}
          </div>
        )}
        <div>
          <dt>Encryption</dt>
          <dd>
            <Lock />
            End-to-end
          </dd>
        </div>
      </dl>
      <div className="panel side-panel">
        <span className="side-label">Tags</span>
        <div className="tags">
          {item.tags.map((t) => (
            <span key={t} className="chip">
              {t}
              {canEdit && (
                <button type="button" className="chip-remove" aria-label={`Remove tag ${t}`} onClick={() => void updateMeta(item, { tags: item.tags.filter((x) => x !== t) })}>
                  <Close />
                </button>
              )}
            </span>
          ))}
          {canEdit &&
            (adding ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void addTag();
                }}
              >
                <label htmlFor="tag-new" className="sr-only">
                  New tag
                </label>
                <input
                  id="tag-new"
                  className="chip-input"
                  autoFocus
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  onBlur={() => void addTag()}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setTag("");
                      setAdding(false);
                    }
                  }}
                />
              </form>
            ) : (
              <button type="button" className="chip chip-add" onClick={() => setAdding(true)}>
                + Add
              </button>
            ))}
          {!canEdit && !item.tags.length && <span className="hint">No tags.</span>}
        </div>
        {item.incoming ? (
          <>
            <span className="side-label">Your access</span>
            <div className="person">
              <span className="avatar">{initials(userName)}</span>
              <b>You</b>
              <span>{item.incoming.role === "edit" ? "Can edit" : "Can view"}</span>
            </div>
          </>
        ) : (
          item.sharedWith.length > 0 && (
            <>
              <span className="side-label">Shared with</span>
              {(people ?? item.sharedWith.map((name) => ({ id: name, name, role: undefined }) as unknown as ShareRecord)).map((p) => (
                <div key={p.id} className="person">
                  <span className="avatar avatar-shared">{initials(p.name)}</span>
                  <b>{p.name}</b>
                  <span>{p.role === "edit" ? "Can edit" : p.role === "view" ? "Can view" : ""}</span>
                </div>
              ))}
            </>
          )
        )}
      </div>
    </>
  );
}

function Versions({ item, canEdit, onRestored }: { item: Item; canEdit: boolean; onRestored: () => Promise<void> }) {
  const [versions, setVersions] = useState<VersionRecord[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    void api<{ versions: VersionRecord[] }>(`/nodes/${item.id}/versions`).then((r) => setVersions(r.versions));
  }, [item.id, item.version]);

  if (!versions) return <div className="panel side-empty">Loading versions…</div>;

  return (
    <ol className="panel versions">
      {versions.map((v) => {
        const current = v.n === item.version;
        return (
          <li key={v.n} className={current ? "is-current" : undefined}>
            <span className="v-num">v{v.n}</span>
            <div className="v-text">
              <b>{formatStamp(v.createdAt)}</b>
              <span>
                {v.by ?? "You"} · {formatBytes(plainSize(v.size))}
              </span>
            </div>
            {current ? (
              <span className="chip chip-sm" style={{ height: 26 }}>
                Current
              </span>
            ) : (
              canEdit && (
                <button
                  type="button"
                  className="pill pill-outline pill-sm"
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy(v.n);
                    const meta: FileMeta = { ...(item.meta as FileMeta), size: plainSize(v.size) };
                    delete meta.pages;
                    await api(`/nodes/${item.id}/versions/${v.n}/restore`, { method: "POST", body: { encMeta: await sealJson(item.key, meta) } });
                    await onRestored();
                  }}
                >
                  {busy === v.n ? "Restoring…" : "Restore"}
                </button>
              )
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Activity({ item, userName }: { item: Item; userName: string }) {
  const [rows, setRows] = useState<ActivityRecord[] | null>(null);

  useEffect(() => {
    void api<{ activity: ActivityRecord[] }>(`/nodes/${item.id}/activity`).then((r) => setRows(r.activity));
  }, [item.id, item.version]);

  if (!rows) return <div className="panel side-empty">Loading activity…</div>;
  if (!rows.length) return <div className="panel side-empty">No activity yet.</div>;

  const describe = (r: ActivityRecord) => {
    const d = r.detail ?? {};
    switch (r.action) {
      case "uploaded":
        return `uploaded version ${d.version ?? 1}`;
      case "restored":
        return `restored version ${d.version}`;
      case "viewed":
        return "viewed the file";
      case "shared":
        return `shared with ${d.name} · can ${d.role === "edit" ? "edit" : "view"}`;
      case "unshared":
        return `stopped sharing with ${d.name}`;
      case "link_created":
        return d.expiresAt ? `created a link · expires ${formatDay(d.expiresAt)}` : "created a link";
      case "link_revoked":
        return "revoked a link";
      case "link_downloaded":
        return "downloaded once";
    }
  };

  return (
    <ul className="panel activity">
      {rows.map((r) => (
        <li key={r.id}>
          {r.isLink ? (
            <span className="avatar">
              <ArrowUpRight />
            </span>
          ) : (
            <span className={`avatar${r.actor ? " avatar-shared" : ""}`}>{initials(r.actor ?? userName)}</span>
          )}
          <div>
            <span>
              <b>{r.isLink ? "Link" : (r.actor ?? "You")}</b> {describe(r)}
            </span>
            <span>{formatStamp(r.createdAt)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
