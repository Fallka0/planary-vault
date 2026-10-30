"use client";

import { useCallback, useEffect, useState } from "react";
import { useVault, type Item } from "./VaultProvider";
import { Dialog } from "./Dialog";
import { api, ApiError, type LinkRecord, type ShareRecord } from "@/lib/api";
import { exportKey, fromB64, sealForRecipient, toB64Url } from "@/lib/crypto";
import { formatDay, initials } from "@/lib/format";

const DAY = 86_400_000;

function isoDay(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The link carries the file key in its fragment (#…), which browsers never send to a server. */
async function linkUrl(item: Item, id: string) {
  return `${window.location.origin}/s/${id}#${toB64Url(await exportKey(item.key))}`;
}

function CopyLink({ item, id }: { item: Item; id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="pill pill-primary pill-sm"
      style={{ height: 36, padding: "0 16px", fontSize: 14 }}
      onClick={async () => {
        await navigator.clipboard.writeText(await linkUrl(item, id));
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      <span key={String(copied)} className="label-swap">
        {copied ? "Copied" : "Copy link"}
      </span>
    </button>
  );
}

export function ShareDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const { plan, refresh } = useVault();
  const [people, setPeople] = useState<ShareRecord[]>([]);
  const [links, setLinks] = useState<LinkRecord[]>([]);
  const [who, setWho] = useState("");
  const [role, setRole] = useState<"view" | "edit">("view");
  const [inviteError, setInviteError] = useState("");
  const [inviting, setInviting] = useState(false);

  const [now] = useState(Date.now);
  // Links carry one file's key; folders are shared with people only.
  const folder = item.kind === "folder";
  const maxDays = plan.linkDays;
  const [password, setPassword] = useState("");
  const [expires, setExpires] = useState(() => isoDay(now + 7 * DAY));
  const [limit, setLimit] = useState(plan.linkDownloads ? String(Math.min(plan.linkDownloads, 10)) : "");
  const [creating, setCreating] = useState(false);
  const [linkError, setLinkError] = useState("");

  const load = useCallback(async () => {
    const res = await api<{ people: ShareRecord[]; links: LinkRecord[] }>(`/nodes/${item.id}/shares`);
    setPeople(res.people);
    setLinks(res.links);
  }, [item.id]);

  useEffect(() => {
    let active = true;
    void api<{ people: ShareRecord[]; links: LinkRecord[] }>(`/nodes/${item.id}/shares`).then((res) => {
      if (!active) return;
      setPeople(res.people);
      setLinks(res.links);
    });
    return () => {
      active = false;
    };
  }, [item.id]);

  const invite = async () => {
    const email = who.trim();
    if (!email.includes("@")) {
      setInviteError("Enter the email of their Planary account.");
      return;
    }
    setInviting(true);
    setInviteError("");
    try {
      const person = await api<{ id: string; publicKey: string }>(`/users/lookup?email=${encodeURIComponent(email)}`);
      const sealedKey = await sealForRecipient(item.key, fromB64(person.publicKey));
      await api(`/nodes/${item.id}/shares`, { method: "POST", body: { recipientId: person.id, role, sealedKey } });
      setWho("");
      await Promise.all([load(), refresh()]);
    } catch (error) {
      setInviteError(error instanceof ApiError && error.status === 404 ? "No vault for that email yet." : "Couldn't share. Try again.");
    } finally {
      setInviting(false);
    }
  };

  const createLink = async () => {
    setCreating(true);
    setLinkError("");
    try {
      const expiresAt = expires ? new Date(`${expires}T23:59:59`).getTime() : null;
      const res = await api<{ id: string }>(`/nodes/${item.id}/links`, {
        method: "POST",
        body: { password: password || undefined, expiresAt, downloadLimit: limit ? Number(limit) : null },
      });
      setPassword("");
      await load();
      // The fresh link goes straight to the clipboard; it can be copied again from the list.
      await navigator.clipboard.writeText(await linkUrl(item, res.id)).catch(() => undefined);
    } catch {
      setLinkError("Couldn't create the link. Try again.");
    } finally {
      setCreating(false);
    }
  };

  const live = links.filter((l) => (!l.expiresAt || l.expiresAt > now) && (l.downloadLimit === null || l.downloads < l.downloadLimit));
  const dead = links.filter((l) => !live.includes(l));

  return (
    <Dialog title={folder ? "Share folder" : "Share file"} onClose={onClose}>
      <div className="share-cols">
        <div className="share-left">
          <section>
            <h3>With Planary users</h3>
            <form
              className="invite"
              onSubmit={(e) => {
                e.preventDefault();
                void invite();
              }}
            >
              <label htmlFor="who" className="sr-only">
                Planary email
              </label>
              <input
                id="who"
                type="email"
                autoFocus
                placeholder="Planary email"
                value={who}
                onChange={(e) => setWho(e.target.value)}
                aria-describedby={inviteError ? "invite-error" : undefined}
              />
              <label htmlFor="role" className="sr-only">
                Access
              </label>
              <select id="role" className="select" value={role} onChange={(e) => setRole(e.target.value as "view" | "edit")}>
                <option value="view">Can view</option>
                <option value="edit">Can edit</option>
              </select>
              <button type="submit" className="pill pill-primary" disabled={inviting}>
                Invite
              </button>
            </form>
            {inviteError && (
              <p id="invite-error" className="error-text" role="alert">
                {inviteError}
              </p>
            )}
          </section>
          {folder ? (
            <p className="hint">People you invite see everything in this folder, including files added later.</p>
          ) : (
            <section>
              <h3>With a link</h3>
              <div className="link-grid">
                <div className="field">
                  <label htmlFor="lpw">Password</label>
                  <input id="lpw" className="input" type="password" autoComplete="new-password" placeholder="Optional" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="exp">Expires</label>
                  <input
                    id="exp"
                    className="input"
                    type="date"
                    min={isoDay(now + DAY)}
                    max={maxDays ? isoDay(now + maxDays * DAY) : undefined}
                    required={maxDays !== null}
                    value={expires}
                    onChange={(e) => setExpires(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="lim">Download limit</label>
                  <input
                    id="lim"
                    className="input"
                    type="number"
                    min={1}
                    max={plan.linkDownloads ?? undefined}
                    placeholder={plan.linkDownloads ? undefined : "Unlimited"}
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                  />
                </div>
              </div>
              <div className="actions" style={{ marginTop: 4 }}>
                <button type="button" className="pill pill-primary" style={{ padding: "0 22px" }} disabled={creating} onClick={() => void createLink()}>
                  Create link
                </button>
              </div>
              {linkError && <p className="error-text">{linkError}</p>}
            </section>
          )}
        </div>
        <section className="share-right" aria-label="Active shares">
          <h3>Active shares</h3>
          {!people.length && !links.length && <p className="share-none">Not shared yet.</p>}
          {people.map((p) => (
            <div key={p.id} className="share-person">
              <span className="avatar avatar-shared">{initials(p.name)}</span>
              <div>
                <b>{p.name}</b>
                <span>{p.role === "edit" ? "Can edit" : "Can view"}</span>
              </div>
              <button
                type="button"
                className="pill pill-outline pill-sm"
                onClick={async () => {
                  await api(`/shares/${p.id}`, { method: "DELETE" });
                  await Promise.all([load(), refresh()]);
                }}
              >
                Revoke
              </button>
            </div>
          ))}
          {live.map((l) => (
            <div key={l.id} className="share-link">
              <div className="share-link-head">
                <b>{l.hasPassword ? "Link · password" : "Link"}</b>
                <span>
                  {l.downloadLimit !== null ? `${l.downloads} of ${l.downloadLimit} downloads` : `${l.downloads} ${l.downloads === 1 ? "download" : "downloads"}`}
                </span>
              </div>
              <span>{l.expiresAt ? `Expires ${formatDay(l.expiresAt)}` : "No expiry"}</span>
              <div className="share-link-actions">
                <CopyLink item={item} id={l.id} />
                <button
                  type="button"
                  className="pill pill-outline pill-sm"
                  style={{ height: 36, padding: "0 16px", fontSize: 14 }}
                  onClick={async () => {
                    await api(`/links/${l.id}`, { method: "DELETE" });
                    await load();
                  }}
                >
                  Revoke
                </button>
              </div>
            </div>
          ))}
          {dead.map((l) => (
            <div key={l.id} className="share-expired">
              <span>{l.expiresAt && l.expiresAt <= now ? `Link · expired ${formatDay(l.expiresAt)}` : "Link · used up"}</span>
              <button
                type="button"
                className="text-btn"
                style={{ color: "var(--text)" }}
                onClick={async () => {
                  await api(`/links/${l.id}`, { method: "DELETE" });
                  await load();
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </section>
      </div>
    </Dialog>
  );
}
